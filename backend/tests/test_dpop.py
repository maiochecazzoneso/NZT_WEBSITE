"""DPoP RFC 9449 validation matrix (D-A5)."""

from __future__ import annotations

import time
import uuid
from typing import Any

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec, rsa
from fastapi import FastAPI

from app.db import Collections
from app.security.dpop import DPoPError, DPoPValidator
from app.security.jose_utils import jwk_thumbprint
from tests.conftest import download, grant, only_user_id, register
from tests.helpers import API_BASE, DPoPKey, b64url, forge_unsigned

PATH = "/api/v1/auth/login"


@pytest.fixture
def validator(app: FastAPI) -> DPoPValidator:
    v: DPoPValidator = app.state.services.dpop
    return v


async def _ok(validator: DPoPValidator, proof: str, **kw: Any) -> None:
    await validator.validate(proof, method=kw.pop("method", "POST"), path=PATH, **kw)


async def _bad(validator: DPoPValidator, proof: str | None, match: str, **kw: Any) -> None:
    with pytest.raises(DPoPError, match=match):
        await validator.validate(proof, method=kw.pop("method", "POST"), path=PATH, **kw)


def test_rfc7638_thumbprint_vector():
    # Example key + jkt from RFC 9449 (sections 4.1 / 6.1).
    rfc_jwk = {
        "kty": "EC",
        "x": "l8tFrhx-34tV3hRICRDY9zCkDlpBhF42UQUfWVAWBFs",
        "y": "9VE4jf_Ok_o64zbTTlcuNJajHmt6v9TDVrU0CdvGRDA",
        "crv": "P-256",
    }
    assert jwk_thumbprint(rfc_jwk) == "0ZcOCORZNYy-DWpqq30jZyJGHTN0d2HglBV3uiguA4I"
    key = DPoPKey()
    assert jwk_thumbprint(key.jwk) == key.thumbprint
    # Non-required members (WebCrypto export adds ext/key_ops) do not change the jkt.
    assert jwk_thumbprint({**key.jwk, "ext": "true", "key_ops": "verify"}) == key.thumbprint


async def test_valid_proof(validator: DPoPValidator):
    key = DPoPKey()
    proof = await validator.validate(key.proof("POST", PATH), method="POST", path=PATH)
    assert proof.jkt == key.thumbprint


async def test_wrong_htm(validator: DPoPValidator):
    await _bad(validator, DPoPKey().proof("GET", PATH), "htm")


async def test_wrong_htu_host_path_scheme(validator: DPoPValidator):
    key = DPoPKey()
    await _bad(validator, key.proof("POST", PATH, htu="https://evil.example" + PATH), "htu")
    await _bad(validator, key.proof("POST", PATH, htu=API_BASE + "/api/v1/auth/register"), "htu")
    await _bad(validator, key.proof("POST", PATH, htu="http://api.nztsolutions.it" + PATH), "htu")


async def test_htu_ignores_query_fragment_and_case_of_host(validator: DPoPValidator):
    key = DPoPKey()
    await _ok(
        validator, key.proof("POST", PATH, htu="https://API.nztsolutions.it:443" + PATH + "?a=1#f")
    )


async def test_stale_and_future_iat(validator: DPoPValidator):
    key = DPoPKey()
    await _bad(validator, key.proof("POST", PATH, iat=time.time() - 120), "iat")
    await _bad(validator, key.proof("POST", PATH, iat=time.time() + 120), "iat")
    await _ok(validator, key.proof("POST", PATH, iat=time.time() - 30))


async def test_replayed_jti(validator: DPoPValidator):
    key = DPoPKey()
    proof = key.proof("POST", PATH, jti=str(uuid.uuid4()))
    await _ok(validator, proof)
    await _bad(validator, proof, "replayed")


async def test_alg_none_rejected(validator: DPoPValidator):
    key = DPoPKey()
    forged = forge_unsigned(
        {"jti": str(uuid.uuid4()), "htm": "POST", "htu": API_BASE + PATH, "iat": int(time.time())},
        {"typ": "dpop+jwt", "alg": "none", "jwk": key.jwk},
    )
    await _bad(validator, forged, "alg")


async def test_hs256_rejected(validator: DPoPValidator):
    key = DPoPKey()
    claims = {
        "jti": str(uuid.uuid4()),
        "htm": "POST",
        "htu": API_BASE + PATH,
        "iat": int(time.time()),
    }
    forged = jwt.encode(
        claims, "a" * 32, algorithm="HS256", headers={"typ": "dpop+jwt", "jwk": key.jwk}
    )
    await _bad(validator, forged, "alg")


async def test_rs256_rejected(validator: DPoPValidator):
    rsa_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pub = rsa_key.public_key().public_numbers()
    jwk = {
        "kty": "RSA",
        "n": b64url(pub.n.to_bytes(256, "big")),
        "e": b64url(pub.e.to_bytes(3, "big")),
    }
    claims = {
        "jti": str(uuid.uuid4()),
        "htm": "POST",
        "htu": API_BASE + PATH,
        "iat": int(time.time()),
    }
    forged = jwt.encode(claims, rsa_key, algorithm="RS256", headers={"typ": "dpop+jwt", "jwk": jwk})
    await _bad(validator, forged, "alg")


async def test_es256_header_with_rsa_jwk_rejected(validator: DPoPValidator):
    key = DPoPKey()
    proof = key.proof(
        "POST", PATH, header_overrides={"jwk": {"kty": "RSA", "n": "AQAB", "e": "AQAB"}}
    )
    await _bad(validator, proof, "P-256")


async def test_jwk_with_private_key_rejected(validator: DPoPValidator):
    key = DPoPKey()
    d = key.private.private_numbers().private_value.to_bytes(32, "big")
    proof = key.proof("POST", PATH, header_overrides={"jwk": {**key.jwk, "d": b64url(d)}})
    await _bad(validator, proof, "private")


async def test_jwk_not_p256_rejected(validator: DPoPValidator):
    p384 = ec.generate_private_key(ec.SECP384R1())
    nums = p384.public_key().public_numbers()
    jwk = {
        "kty": "EC",
        "crv": "P-384",
        "x": b64url(nums.x.to_bytes(48, "big")),
        "y": b64url(nums.y.to_bytes(48, "big")),
    }
    claims = {
        "jti": str(uuid.uuid4()),
        "htm": "POST",
        "htu": API_BASE + PATH,
        "iat": int(time.time()),
    }
    proof = jwt.encode(claims, p384, algorithm="ES384", headers={"typ": "dpop+jwt", "jwk": jwk})
    await _bad(validator, proof, "alg")
    # Even claiming ES256 with a P-384 jwk is rejected.
    key = DPoPKey()
    await _bad(validator, key.proof("POST", PATH, header_overrides={"jwk": jwk}), "P-256")


async def test_signature_by_other_key_rejected(validator: DPoPValidator):
    key, other = DPoPKey(), DPoPKey()
    await _bad(validator, key.proof("POST", PATH, header_overrides={"jwk": other.jwk}), "signature")


async def test_wrong_typ_and_missing_claims(validator: DPoPValidator):
    key = DPoPKey()
    await _bad(validator, key.proof("POST", PATH, header_overrides={"typ": "JWT"}), "typ")
    await _bad(validator, key.proof("POST", PATH, omit=("jti",)), "claims")
    await _bad(validator, key.proof("POST", PATH, omit=("iat",)), "claims")
    await _bad(validator, None, "missing")
    await _bad(validator, "not-a-jwt", "malformed")


async def test_missing_and_invalid_ath(validator: DPoPValidator):
    key = DPoPKey()
    token = "header.payload.signature"
    await _bad(validator, key.proof("POST", PATH), "missing ath", access_token=token)
    await _bad(
        validator,
        key.proof("POST", PATH, access_token="other.token.value"),
        "ath mismatch",
        access_token=token,
    )
    await _ok(validator, key.proof("POST", PATH, access_token=token), access_token=token)


# --- protected resource level ----------------------------------------------------------
async def _session(client: httpx.AsyncClient, db: Collections) -> tuple[DPoPKey, str]:
    key = DPoPKey()
    resp = await register(client, key)
    await grant(db, await only_user_id(db))
    return key, resp.json()["access_token"]


async def test_resource_valid(client: httpx.AsyncClient, mongo: Collections):
    key, token = await _session(client, mongo)
    assert (await download(client, key, token)).status_code == 200


async def test_resource_missing_ath(client: httpx.AsyncClient, mongo: Collections):
    key, token = await _session(client, mongo)
    path = "/api/v1/downloads/launcher"
    resp = await client.get(
        path, headers={"Authorization": f"DPoP {token}", "DPoP": key.proof("GET", path)}
    )
    assert resp.status_code == 401
    assert 'error="invalid_dpop_proof"' in resp.headers["www-authenticate"]


async def test_resource_jkt_mismatch(client: httpx.AsyncClient, mongo: Collections):
    _key, token = await _session(client, mongo)
    thief = DPoPKey()  # stolen access token, attacker's own key
    resp = await download(client, thief, token)
    assert resp.status_code == 401
    assert resp.json() == {"detail": "Invalid access token"}
    assert 'error="invalid_token"' in resp.headers["www-authenticate"]


async def test_resource_token_without_cnf(
    app: FastAPI, client: httpx.AsyncClient, mongo: Collections
):
    key, _ = await _session(client, mongo)
    svc = app.state.services.tokens
    user_id = await only_user_id(mongo)
    now = int(time.time())
    no_cnf = jwt.encode(
        {"sub": str(user_id), "iss": API_BASE, "iat": now, "exp": now + 600, "jti": "x"},
        svc._key,
        algorithm="EdDSA",
        headers={"kid": svc.kid, "typ": "at+jwt"},
    )
    resp = await download(client, key, no_cnf)
    assert resp.status_code == 401
    assert "cnf" in resp.headers["www-authenticate"]


async def test_resource_bearer_scheme_rejected(client: httpx.AsyncClient, mongo: Collections):
    key, token = await _session(client, mongo)
    path = "/api/v1/downloads/launcher"
    resp = await client.get(
        path,
        headers={
            "Authorization": f"Bearer {token}",
            "DPoP": key.proof("GET", path, access_token=token),
        },
    )
    assert resp.status_code == 401


async def test_resource_no_auth_header(client: httpx.AsyncClient):
    resp = await client.get("/api/v1/downloads/launcher")
    assert resp.status_code == 401
    assert resp.headers["www-authenticate"] == 'DPoP algs="ES256"'


async def test_resource_expired_and_forged_tokens(
    app: FastAPI, client: httpx.AsyncClient, mongo: Collections
):
    key, token = await _session(client, mongo)
    svc = app.state.services.tokens
    user_id = await only_user_id(mongo)
    expired = svc.issue(user_id=user_id, jkt=key.thumbprint, now=int(time.time()) - 3600)
    assert (await download(client, key, expired)).status_code == 401
    # Same claims signed by a different Ed25519 key.
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

    claims = jwt.decode(token, options={"verify_signature": False})
    forged = jwt.encode(
        claims,
        Ed25519PrivateKey.generate(),
        algorithm="EdDSA",
        headers={"kid": svc.kid, "typ": "at+jwt"},
    )
    assert (await download(client, key, forged)).status_code == 401


async def test_resource_inactive_user(client: httpx.AsyncClient, mongo: Collections):
    key, token = await _session(client, mongo)
    await mongo.users.update_many({}, {"$set": {"isActive": False}})
    assert (await download(client, key, token)).status_code == 401


async def test_proof_replay_at_endpoint(client: httpx.AsyncClient):
    key = DPoPKey()
    proof = key.proof("POST", "/api/v1/auth/register")
    body = {"email": "r@domain.com", "password": "SuperSecurePassword123!"}
    first = await client.post("/api/v1/auth/register", json=body, headers={"DPoP": proof})
    assert first.status_code == 201
    again = await client.post("/api/v1/auth/login", json=body, headers={"DPoP": proof})
    assert again.status_code == 401  # htu mismatch AND replay
    replay = await client.post("/api/v1/auth/register", json=body, headers={"DPoP": proof})
    assert replay.status_code == 401
    assert "replayed" in replay.headers["www-authenticate"]
