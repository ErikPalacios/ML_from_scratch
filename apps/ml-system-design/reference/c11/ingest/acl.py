"""Permisos (caso c11): de las ACLs de Confluence, Drive y Jira a un filtro que el índice aplica ANTES del top-k.

El requisito más duro del caso: un chunk que la persona no puede abrir en la fuente NUNCA llega a su prompt. No
alcanza con "decirle al modelo que no lo muestre" (es una instrucción, no un control) ni con filtrar la respuesta
después de generarla. El filtro va DENTRO del retrieval (retrieval/hybrid.py), en la misma consulta al índice.

Tres piezas:
  1. Normalizar la ACL de cada documento a PRINCIPALES con prefijo de tipo y namespace:
       user:ana@acme.com · group:google:soporte-mx@acme.com · group:atlassian:confluence-users ·
       role:jira:PAG:developers · domain:acme.com
  2. Expandir a una persona en TODOS sus principales con una foto del IdP (IdentitySnapshot): sus grupos directos,
     los grupos que contienen a esos grupos (Google Groups se anidan), los roles de proyecto de Jira que la
     incluyen (a ella o a uno de sus grupos) y el dominio de la empresa.
  3. El filtro: el documento es visible si CADA cláusula de su ACL comparte al menos un principal con la persona.

Por qué una ACL es una lista de CLÁUSULAS (un AND de ORs) y no un solo conjunto:
  Confluence: ver una página exige permiso de ver el ESPACIO y, además, estar en las restricciones de lectura de la
  página y de CADA ancestro restringido (las restricciones de lectura se heredan hacia abajo). Jira: "Browse
  Projects" en el proyecto Y, si el issue tiene nivel de seguridad, estar en ese nivel. Eso es un AND. Un solo
  conjunto ("cualquiera de estos principales") sería un OR y dejaría ver la página restringida a quien solo puede
  ver el espacio. La alternativa (expandir todo a usuarios al indexar) obliga a re-escribir millones de chunks cada
  vez que alguien entra o sale de un grupo.

Cómo vive en el índice: cada chunk lleva campos keyword acl_0, acl_1, acl_2 (uno por cláusula, MAX_CLAUSES = 3);
las cláusulas que sobran se rellenan con OPEN, un principal que TODA persona conocida tiene. El filtro es un
`terms` por campo con los principales de la persona (opensearch_filter). Un documento con más de 3 cláusulas (una
página con restricciones en 3 ancestros distintos) NO se indexa (AclTooComplex): se cuenta y se revisa; fallar
cerrado es mejor que aproximar un permiso.

Grupos y roles se resuelven al CONSULTAR (no al indexar): si alguien sale de un grupo, el cambio aplica cuando
llega la próxima foto del IdP (cada ≈ 60 s; el servicio se niega a contestar con una foto de más de 5 min, ver
service/app.py). Un cambio en la ACL de un documento es otra cosa: llega por la ingesta como actualización de
metadatos sin re-embeber (ingest/incremental.py).

Modelos SIMPLIFICADOS de cada fuente (documentados en cada función; verifica contra la API que uses):
  - Confluence: permiso de ver el espacio (usuarios y grupos) + restricciones de lectura de la página y de sus
    ancestros. La API REST devuelve las restricciones PROPIAS de una página, no las heredadas: el conector recorre
    los ancestros y pide las de cada uno. Las restricciones de EDICIÓN no limitan la lectura y se ignoran. El
    acceso anónimo a un espacio no se traduce en "todos" (sale de la ACL: se indexa solo lo concedido explícito).
  - Drive: la lista de permisos del archivo (type user/group/domain/anyone, con allowFileDiscovery). En unidades
    compartidas la lista incluye los heredados (permissionDetails.inheritedFrom). Todos los roles (reader,
    commenter, writer, fileOrganizer, organizer, owner) pueden leer.
  - Jira: los concedidos de "Browse Projects" en el esquema de permisos del proyecto (rol de proyecto, grupo,
    usuario, cualquier usuario con sesión, reporter, assignee) + el nivel de seguridad del issue, si tiene.

LA TRAMPA DEL LINK: "cualquiera con el enlace" (Drive type=anyone o type=domain con allowFileDiscovery=false) NO
cuenta como compartido. Quien tiene el enlace puede abrirlo, pero el asistente no sabe quién tiene el enlace: si lo
tratara como público, cualquier empleado encontraría por búsqueda un documento que su dueño compartió con 3
personas por chat. Costo, y hay que decirlo: en Google Workspace compartir "con cualquiera de la organización que
tenga el enlace" es muy común, así que esos documentos NO aparecen para quien no tenga un permiso explícito. Se
mide (los motivos ignorados salen en AclResult.ignored) y es una decisión de producto, no un bug.

Puro: biblioteca estándar, sin I/O.
"""

from __future__ import annotations  # anotaciones como texto

import hashlib  # huella de la ACL: ¿cambió? (ingesta incremental)
from collections.abc import Iterable, Mapping, Sequence  # tipos de entrada
from dataclasses import dataclass, field  # resultados inmutables

OPEN = "acl:open"  # relleno de cláusulas vacías: lo tiene toda persona CONOCIDA; ninguna fuente puede producirlo
MAX_CLAUSES = 3  # campos acl_0..acl_2 en el índice (espacio + 2 niveles de restricción; proyecto + seguridad)
_PREFIXES = ("user:", "group:", "role:", "domain:")  # todo principal válido empieza con uno de estos


class AclTooComplex(ValueError):
    """La ACL necesita más cláusulas de las que tiene el índice: el documento no se indexa (falla cerrado)."""


# ---------------------------------------------------------------------------- principales
def user(email: str) -> str:
    return "user:" + email.strip().lower()  # los emails llegan con mayúsculas distintas según la fuente


def group(namespace: str, name: str) -> str:
    # El namespace evita que "soporte" de Atlassian y "soporte@acme.com" de Google se confundan: son grupos
    # distintos aunque se llamen parecido (y uno puede tener gente que el otro no).
    return f"group:{namespace}:{name.strip().lower()}"


def domain(name: str) -> str:
    return "domain:" + name.strip().lower()


def jira_role(project_key: str, role: str) -> str:
    # Un rol de proyecto es un principal propio: sus miembros se resuelven al consultar (role_members del IdP),
    # así que agregar a alguien a "Developers" de un proyecto no obliga a re-escribir los issues de ese proyecto.
    return f"role:jira:{project_key.strip().upper()}:{role.strip().lower()}"


# ---------------------------------------------------------------------------- ACL de un documento
@dataclass(frozen=True)
class DocumentACL:
    """AND de cláusulas; cada cláusula es un OR de principales. Construir con from_clauses."""

    clauses: tuple[tuple[str, ...], ...]

    @classmethod
    def from_clauses(cls, clauses: Iterable[Iterable[str]]) -> DocumentACL:
        sets = [frozenset(c) for c in clauses]
        if not sets:
            # "sin cláusulas" leído como "sin restricciones" sería el bug clásico: público por omisión
            raise ValueError("una ACL necesita al menos una cláusula")
        for s in sets:
            if not s:
                raise ValueError("cláusula vacía: nadie puede ver el documento (no se indexa; ver AclResult)")
            for p in s:
                if p == OPEN or not p.startswith(_PREFIXES):
                    # OPEN solo lo pone este módulo al rellenar; si viene de afuera, alguien inventó un comodín
                    raise ValueError(f"principal inválido: {p!r}")
        # Simplificación sin cambiar el significado: si A ⊆ B, cumplir A implica cumplir B → B sobra.
        kept = [s for s in sets if not any(o < s for o in sets)]
        unique = sorted({tuple(sorted(s)) for s in kept})  # orden determinista: la huella no depende del orden
        return cls(tuple(unique))

    def allows(self, principals: frozenset[str]) -> bool:
        return all(any(p in principals for p in c) for c in self.clauses)

    def index_fields(self, max_clauses: int = MAX_CLAUSES) -> dict[str, tuple[str, ...]]:
        """Los campos acl_i del chunk en el índice; las cláusulas que sobran se rellenan con OPEN."""
        if len(self.clauses) > max_clauses:
            raise AclTooComplex(f"{len(self.clauses)} cláusulas > {max_clauses}")
        fields = {f"acl_{i}": c for i, c in enumerate(self.clauses)}
        for i in range(len(self.clauses), max_clauses):
            fields[f"acl_{i}"] = (OPEN,)
        return fields

    def fingerprint(self) -> str:
        return hashlib.sha256(repr(self.clauses).encode()).hexdigest()[:16]


@dataclass(frozen=True)
class AclResult:
    acl: DocumentACL | None  # None = nadie tiene un permiso explícito → el documento NO se indexa
    ignored: tuple[str, ...] = ()  # por qué se ignoró cada permiso ("drive:anyone_with_link", …): se cuentan


# ---------------------------------------------------------------------------- normalizadores por fuente
@dataclass(frozen=True)
class Grants:
    """Usuarios y grupos (Atlassian) de un permiso de espacio o de una restricción de lectura de Confluence."""

    users: tuple[str, ...] = ()
    groups: tuple[str, ...] = ()

    def principals(self) -> set[str]:
        return {user(u) for u in self.users} | {group("atlassian", g) for g in self.groups}


def confluence_acl(space_view: Grants, read_restrictions: Sequence[Grants | None]) -> AclResult:
    """Página de Confluence.

    space_view: quién puede ver el espacio (de los permisos del espacio).
    read_restrictions: restricciones de LECTURA de cada ancestro (raíz primero) y de la página al final; None o
      vacío = ese nivel no restringe. Cada nivel restringido es OTRA cláusula (AND), porque una página restringida
      bajo otra restringida exige estar en las dos.
    """
    space = space_view.principals()
    if not space:
        return AclResult(None, ("confluence:space_without_grants",))
    clauses = [space]
    for r in read_restrictions:
        if r is not None and (r.users or r.groups):
            clauses.append(r.principals())
    return AclResult(DocumentACL.from_clauses(clauses))


def drive_acl(permissions: Sequence[Mapping], company_domain: str) -> AclResult:
    """Archivo de Drive: una sola cláusula (cualquiera de los permisos alcanza para leer).

    permissions: los recursos `permission` de la API v3 (type, emailAddress, domain, allowFileDiscovery, deleted,
      view).
    """
    allowed: set[str] = set()
    ignored: list[str] = []
    company = company_domain.strip().lower()
    for p in permissions:
        kind = p.get("type")
        if p.get("deleted"):
            ignored.append("drive:deleted_account")  # la cuenta del permiso ya no existe
        elif p.get("view"):
            # Permisos de una "vista" (la API documenta `published` y `metadata`): no dan acceso al contenido
            # actual del archivo (metadata = solo ver que existe). Se ignoran: cerrado ante la duda.
            ignored.append(f"drive:view_{p['view']}")
        elif kind == "user" and p.get("emailAddress"):
            allowed.add(user(p["emailAddress"]))
        elif kind == "group" and p.get("emailAddress"):
            allowed.add(group("google", p["emailAddress"]))
        elif kind == "domain":
            if (p.get("domain") or "").lower() != company:
                ignored.append("drive:other_domain")  # compartido con otra empresa: no le sirve a nadie de aquí
            elif p.get("allowFileDiscovery"):
                allowed.add(domain(company))  # "cualquiera de acme.com puede encontrarlo": visible para todos
            else:
                ignored.append("drive:domain_with_link")  # LA TRAMPA: solo quien tiene el enlace
        elif kind == "anyone":
            if p.get("allowFileDiscovery"):
                allowed.add(domain(company))  # público en la web: cualquier empleado puede abrirlo
            else:
                ignored.append("drive:anyone_with_link")  # LA TRAMPA: "cualquiera con el enlace" ≠ todos
        else:
            ignored.append(f"drive:unknown_type:{kind}")  # un tipo nuevo de la API: se ignora (cerrado)
    if not allowed:
        return AclResult(None, tuple(ignored))
    return AclResult(DocumentACL.from_clauses([allowed]), tuple(ignored))


def _jira_clause(grants: Sequence[tuple[str, str]], project_key: str, company_domain: str,
                 reporter: str | None, assignee: str | None, ignored: list[str]) -> set[str]:
    out: set[str] = set()
    for kind, value in grants:
        if kind == "user":
            out.add(user(value))
        elif kind == "group":
            out.add(group("atlassian", value))
        elif kind == "role":
            out.add(jira_role(project_key, value))
        elif kind == "logged_in":
            out.add(domain(company_domain))  # cualquier usuario con sesión del sitio = cualquier empleado
        elif kind == "reporter":
            if reporter:
                out.add(user(reporter))
        elif kind == "assignee":
            if assignee:
                out.add(user(assignee))
        else:
            ignored.append(f"jira:unknown_grant:{kind}")
    return out


def jira_acl(project_key: str, browse_grants: Sequence[tuple[str, str]], company_domain: str,
             security_level: Sequence[tuple[str, str]] | None = None,
             reporter: str | None = None, assignee: str | None = None) -> AclResult:
    """Issue de Jira: "Browse Projects" del proyecto AND (si existe) su nivel de seguridad.

    Cada concedido es (tipo, valor): ("role", "Developers"), ("group", "soporte-n2"), ("user", email),
    ("logged_in", ""), ("reporter", ""), ("assignee", ""). reporter/assignee del issue resuelven esos dos.
    """
    ignored: list[str] = []
    browse = _jira_clause(browse_grants, project_key, company_domain, reporter, assignee, ignored)
    if not browse:
        return AclResult(None, (*ignored, "jira:no_browse_grants"))
    clauses = [browse]
    if security_level is not None:
        level = _jira_clause(security_level, project_key, company_domain, reporter, assignee, ignored)
        if not level:
            return AclResult(None, (*ignored, "jira:empty_security_level"))
        clauses.append(level)
    return AclResult(DocumentACL.from_clauses(clauses), tuple(ignored))


# ---------------------------------------------------------------------------- personas → principales
@dataclass(frozen=True)
class IdentitySnapshot:
    """Foto del IdP (Okta / Google): quién está activo, en qué grupos y en qué roles de Jira. Se refresca ≈ 60 s."""

    taken_at: float  # epoch s: el servicio mide su edad y falla cerrado si es vieja
    company_domain: str
    user_groups: Mapping[str, frozenset[str]]  # email → grupos DIRECTOS (principales group:…). Solo activos.
    group_parents: Mapping[str, frozenset[str]] = field(default_factory=dict)  # grupo → grupos que lo contienen
    role_members: Mapping[str, frozenset[str]] = field(default_factory=dict)  # role:jira:… → user:/group: miembros

    def age_s(self, now: float) -> float:
        return max(0.0, now - self.taken_at)

    def principals_for(self, email: str) -> frozenset[str]:
        """Todos los principales de una persona. Vacío = desconocida o desactivada → no ve nada."""
        email = email.strip().lower()
        if email not in self.user_groups:
            # Quien no está en la foto (desactivada ayer, o un token de otra empresa) no recibe ni OPEN:
            # sin OPEN ningún campo acl_i rellenado coincide, así que el filtro no deja pasar nada.
            return frozenset()
        groups: set[str] = set()
        pending = list(self.user_groups[email])
        while pending:  # cierre transitivo de grupos anidados; `groups` corta los ciclos (A ∈ B ∈ A)
            g = pending.pop()
            if g in groups:
                continue
            groups.add(g)
            pending.extend(self.group_parents.get(g, ()))
        principals = {user(email), OPEN, *groups}
        if email.rsplit("@", 1)[-1] == self.company_domain.lower():
            # Solo quien tiene email de la empresa: un contratista con email de su consultora no es "todo acme.com"
            principals.add(domain(self.company_domain))
        for role, members in self.role_members.items():
            if members & principals:  # el rol incluye a la persona o a uno de sus grupos
                principals.add(role)
        return frozenset(principals)


# ---------------------------------------------------------------------------- el filtro del índice
def opensearch_filter(principals: frozenset[str], max_clauses: int = MAX_CLAUSES) -> dict:
    """Filtro para la consulta de OpenSearch: un `terms` por campo acl_i (todos deben coincidir).

    Va como `filter` DENTRO de la cláusula knn (filtrado eficiente) y en el `filter` del bool de BM25, o como
    `filter` de nivel superior de una consulta `hybrid` (OpenSearch 3.0+), que lo aplica a cada subconsulta.
    Un `terms` acepta hasta index.max_terms_count términos (65,536 por defecto): sobra para los grupos de una persona.
    """
    if not principals:
        # Sin principales no hay filtro posible: match_none explícito (un `terms` vacío también no coincide con
        # nada, pero así se lee en el log que fue a propósito).
        return {"match_none": {}}
    values = sorted(principals)
    return {"bool": {"filter": [{"terms": {f"acl_{i}": values}} for i in range(max_clauses)]}}


def fields_allow(acl_fields: Mapping[str, Sequence[str]], principals: frozenset[str],
                 max_clauses: int = MAX_CLAUSES) -> bool:
    """La MISMA regla que opensearch_filter, en Python: la usan el índice en memoria y la verificación final.

    Un campo acl_i que falta cuenta como "no coincide": un chunk indexado sin ACL es invisible (falla cerrado).
    """
    return all(any(p in principals for p in acl_fields.get(f"acl_{i}", ())) for i in range(max_clauses))
