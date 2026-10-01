"""Los adaptadores REALES de boto3 (S3Store, StepFunctionsStarter) contra moto: S3, KMS y Step Functions
en memoria. moto no es AWS (no aplica IAM ni ejecuta los estados), pero sí valida las llamadas y su forma."""

import json
import os

import boto3
import pytest
from moto import mock_aws

import main

REGION = "us-east-1"


@pytest.fixture(autouse=True)
def fake_credentials(monkeypatch):
    # Credenciales falsas: si algo se escapara de moto, AWS lo rechazaría en vez de cobrar.
    for k, v in {"AWS_ACCESS_KEY_ID": "testing", "AWS_SECRET_ACCESS_KEY": "testing",
                 "AWS_DEFAULT_REGION": REGION}.items():
        monkeypatch.setenv(k, v)


@mock_aws
def test_s3store_cifra_con_la_llave_kms_indicada():
    s3, kms = boto3.client("s3", region_name=REGION), boto3.client("kms", region_name=REGION)
    s3.create_bucket(Bucket="docs-raw")
    key_id = kms.create_key(Description="docs-raw")["KeyMetadata"]["KeyId"]
    store = main.S3Store("docs-raw", key_id, client=s3)
    store.put("raw/doc-1/01-abc.jpg", b"\xff\xd8\xff bytes", "image/jpeg")
    head = s3.head_object(Bucket="docs-raw", Key="raw/doc-1/01-abc.jpg")
    assert head["ServerSideEncryption"] == "aws:kms"
    assert head["SSEKMSKeyId"].endswith(key_id) and head["ContentType"] == "image/jpeg"


@mock_aws
def test_s3store_sin_llave_explicita_igual_pide_kms():
    s3 = boto3.client("s3", region_name=REGION)
    s3.create_bucket(Bucket="docs-raw")
    main.S3Store("docs-raw", None, client=s3).put("k", b"x", "application/pdf")
    assert s3.head_object(Bucket="docs-raw", Key="k")["ServerSideEncryption"] == "aws:kms"


def _state_machine(sfn) -> str:
    definition = (os.path.join(os.path.dirname(__file__), "..", "..", "orchestration", "statemachine.asl.json"))
    with open(definition, encoding="utf-8") as fh:
        body = fh.read()
    return sfn.create_state_machine(
        name="doc-pipeline", definition=body, type="STANDARD",
        roleArn="arn:aws:iam::123456789012:role/doc-pipeline-sfn")["stateMachineArn"]


@mock_aws
def test_starter_usa_document_id_como_nombre_y_no_duplica():
    sfn = boto3.client("stepfunctions", region_name=REGION)
    arn = _state_machine(sfn)
    starter = main.StepFunctionsStarter(arn, client=sfn)
    payload = {"document_id": "0b7e…", "pages": [{"key": "raw/x/01.jpg"}]}
    exec_arn = starter.start("doc-0001", payload)
    assert exec_arn.endswith(":execution:doc-pipeline:doc-0001")
    # Segundo intento (el barrido, o un reintento): misma ejecución, nunca una segunda.
    again = starter.start("doc-0001", payload)
    assert again == exec_arn
    assert len(sfn.list_executions(stateMachineArn=arn)["executions"]) == 1
    started = sfn.describe_execution(executionArn=exec_arn)
    assert json.loads(started["input"]) == payload


@mock_aws
def test_starter_con_input_distinto_no_relanza():
    sfn = boto3.client("stepfunctions", region_name=REGION)
    arn = _state_machine(sfn)
    starter = main.StepFunctionsStarter(arn, client=sfn)
    first = starter.start("doc-0002", {"v": 1})
    # Mismo name con otro input → ExecutionAlreadyExists en AWS; el adaptador no lanza otra ejecución.
    assert starter.start("doc-0002", {"v": 2}) == first
    assert len(sfn.list_executions(stateMachineArn=arn)["executions"]) == 1
