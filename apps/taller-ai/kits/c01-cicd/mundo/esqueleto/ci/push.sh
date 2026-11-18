#!/usr/bin/env bash
# Sube la imagen al ECR del dojo (tuyo). Uso, dentro del job imagen: ci/push.sh <imagen>
# Contrato: entra a ECR con el rol del CI ($ROL) cambiando el token OIDC del job
# (python mundo/nube.py ecr get-login-password --role-arn … | docker login --username AWS --password-stdin <registro>),
# hace docker push y escribe una línea digest=sha256:… en $GITHUB_OUTPUT, con el digest que devolvió el registro.
set -euo pipefail
echo "ci/push.sh: falta escribirlo"; exit 1
