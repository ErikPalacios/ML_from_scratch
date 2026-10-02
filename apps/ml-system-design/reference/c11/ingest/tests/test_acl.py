"""Tests de permisos: normalización por fuente, expansión de personas, el filtro y las trampas."""

import pytest

from acl import (OPEN, AclTooComplex, DocumentACL, Grants, IdentitySnapshot, confluence_acl, domain, drive_acl,
                 fields_allow, group, jira_acl, jira_role, opensearch_filter, user)

SNAP = IdentitySnapshot(
    taken_at=1000.0,
    company_domain="acme.com",
    user_groups={
        "ana@acme.com": frozenset({"group:google:soporte-mx@acme.com", "group:atlassian:soporte"}),
        "luis@acme.com": frozenset({"group:google:finanzas@acme.com"}),
        "carlos@consultora.com": frozenset({"group:atlassian:contratistas"}),
    },
    group_parents={
        "group:google:soporte-mx@acme.com": frozenset({"group:google:soporte@acme.com"}),
        "group:google:soporte@acme.com": frozenset({"group:google:operaciones@acme.com"}),
        "group:google:operaciones@acme.com": frozenset({"group:google:soporte-mx@acme.com"}),  # ciclo a propósito
    },
    role_members={"role:jira:PAG:developers": frozenset({"group:google:finanzas@acme.com"})},
)


def visible(acl_result, email):
    return acl_result.acl is not None and acl_result.acl.allows(SNAP.principals_for(email))


# ---------------------------------------------------------------- Drive
def test_drive_user_group_and_discoverable_domain_grant_access():
    r = drive_acl([{"type": "group", "role": "reader", "emailAddress": "Soporte@acme.com"}], "acme.com")
    assert visible(r, "ana@acme.com")  # por el grupo anidado soporte-mx → soporte (y el email en mayúsculas)
    assert not visible(r, "luis@acme.com")
    r = drive_acl([{"type": "domain", "role": "reader", "domain": "acme.com", "allowFileDiscovery": True}], "acme.com")
    assert visible(r, "ana@acme.com") and visible(r, "luis@acme.com")
    assert not visible(r, "carlos@consultora.com")  # el contratista no es "todo acme.com"


def test_trap_anyone_with_the_link_is_not_shared():
    r = drive_acl([{"type": "anyone", "role": "reader", "allowFileDiscovery": False}], "acme.com")
    assert r.acl is None and r.ignored == ("drive:anyone_with_link",)  # nadie: no se indexa
    r = drive_acl([{"type": "domain", "role": "reader", "domain": "acme.com", "allowFileDiscovery": False}], "acme.com")
    assert r.acl is None and r.ignored == ("drive:domain_with_link",)


def test_link_sharing_does_not_widen_an_explicit_share():
    r = drive_acl([{"type": "group", "role": "reader", "emailAddress": "finanzas@acme.com"},
                   {"type": "anyone", "role": "reader", "allowFileDiscovery": False}], "acme.com")
    assert visible(r, "luis@acme.com") and not visible(r, "ana@acme.com")


def test_drive_ignores_other_domains_deleted_accounts_and_view_permissions():
    r = drive_acl([{"type": "domain", "role": "reader", "domain": "otra.com", "allowFileDiscovery": True},
                   {"type": "user", "role": "reader", "emailAddress": "ex@acme.com", "deleted": True},
                   {"type": "user", "role": "reader", "emailAddress": "ana@acme.com", "view": "metadata"}], "acme.com")
    assert r.acl is None
    assert set(r.ignored) == {"drive:other_domain", "drive:deleted_account", "drive:view_metadata"}


# ---------------------------------------------------------------- Confluence
def test_confluence_restricted_page_needs_space_and_every_restriction():
    space = Grants(groups=("confluence-users",))
    # página restringida a "soporte" bajo un padre restringido a ana y luis: hay que estar en LAS DOS
    r = confluence_acl(space, [Grants(users=("ana@acme.com", "luis@acme.com")), Grants(groups=("soporte",))])
    snap = IdentitySnapshot(1000.0, "acme.com", {
        "ana@acme.com": frozenset({"group:atlassian:confluence-users", "group:atlassian:soporte"}),
        "luis@acme.com": frozenset({"group:atlassian:confluence-users"}),
        "sofia@acme.com": frozenset({"group:atlassian:confluence-users", "group:atlassian:soporte"}),
    })
    assert len(r.acl.clauses) == 3
    assert r.acl.allows(snap.principals_for("ana@acme.com"))
    assert not r.acl.allows(snap.principals_for("luis@acme.com"))  # está en el padre, no en "soporte"
    assert not r.acl.allows(snap.principals_for("sofia@acme.com"))  # está en "soporte", no en el padre


def test_confluence_unrestricted_ancestors_add_nothing():
    r = confluence_acl(Grants(groups=("soporte",)), [None, Grants(), None])
    assert len(r.acl.clauses) == 1


def test_confluence_space_without_grants_is_not_indexed():
    assert confluence_acl(Grants(), []).acl is None


# ---------------------------------------------------------------- Jira
def test_jira_role_resolves_at_query_time():
    r = jira_acl("PAG", [("role", "Developers")], "acme.com")
    assert r.acl.clauses == ((jira_role("PAG", "developers"),),)
    assert visible(r, "luis@acme.com")  # su grupo finanzas está en el rol (role_members del IdP)
    assert not visible(r, "ana@acme.com")


def test_jira_security_level_is_an_and():
    r = jira_acl("SEC", [("logged_in", "")], "acme.com", security_level=[("assignee", "")], assignee="ana@acme.com")
    assert visible(r, "ana@acme.com")
    assert not visible(r, "luis@acme.com")  # puede ver el proyecto, no este issue
    r = jira_acl("SEC", [("logged_in", "")], "acme.com", security_level=[("assignee", "")], assignee=None)
    assert r.acl is None  # nivel de seguridad que no resuelve a nadie: cerrado


# ---------------------------------------------------------------- personas
def test_principals_expand_nested_groups_with_cycles_domain_and_roles():
    p = SNAP.principals_for("ANA@acme.com")
    assert {user("ana@acme.com"), OPEN, domain("acme.com"), "group:google:soporte@acme.com",
            "group:google:operaciones@acme.com"} <= p
    assert "role:jira:PAG:developers" in SNAP.principals_for("luis@acme.com")


def test_unknown_or_deactivated_person_gets_nothing_not_even_open():
    assert SNAP.principals_for("exempleado@acme.com") == frozenset()


def test_snapshot_age():
    assert SNAP.age_s(1300.0) == 300.0


# ---------------------------------------------------------------- la ACL y el filtro
def test_acl_simplifies_redundant_clauses():
    acl = DocumentACL.from_clauses([{"user:a@acme.com"}, {"user:a@acme.com", "group:google:x@acme.com"}])
    assert acl.clauses == (("user:a@acme.com",),)  # cumplir la primera implica cumplir la segunda


def test_acl_rejects_empty_and_forged_principals():
    with pytest.raises(ValueError):
        DocumentACL.from_clauses([])  # "sin cláusulas" NO es público
    with pytest.raises(ValueError):
        DocumentACL.from_clauses([set()])
    with pytest.raises(ValueError):
        DocumentACL.from_clauses([{OPEN}])  # una fuente no puede producir el comodín
    with pytest.raises(ValueError):
        DocumentACL.from_clauses([{"ana@acme.com"}])  # sin prefijo de tipo


def test_index_fields_pad_with_open_and_fail_closed_when_too_complex():
    acl = DocumentACL.from_clauses([{group("atlassian", "soporte")}])
    f = acl.index_fields()
    assert f == {"acl_0": ("group:atlassian:soporte",), "acl_1": (OPEN,), "acl_2": (OPEN,)}
    assert fields_allow(f, SNAP.principals_for("ana@acme.com"))
    assert not fields_allow(f, SNAP.principals_for("luis@acme.com"))
    assert not fields_allow(f, frozenset())  # nadie sin principales pasa, ni siquiera por las cláusulas OPEN
    four = DocumentACL.from_clauses([{f"user:{i}@acme.com"} for i in range(4)])
    with pytest.raises(AclTooComplex):
        four.index_fields()


def test_missing_acl_field_means_invisible():
    assert not fields_allow({"acl_0": ("user:ana@acme.com",)}, SNAP.principals_for("ana@acme.com"))


def test_opensearch_filter_has_one_terms_per_clause():
    f = opensearch_filter(frozenset({"user:ana@acme.com", OPEN}))
    assert f == {"bool": {"filter": [{"terms": {f"acl_{i}": [OPEN, "user:ana@acme.com"]}} for i in range(3)]}}
    assert opensearch_filter(frozenset()) == {"match_none": {}}


def test_fingerprint_ignores_order():
    a = DocumentACL.from_clauses([{"user:a@acme.com", "user:b@acme.com"}])
    b = DocumentACL.from_clauses([{"user:b@acme.com", "user:a@acme.com"}])
    assert a.fingerprint() == b.fingerprint()
