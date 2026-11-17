"""Client IP resolution with explicit proxy trust (D-A10).

X-Forwarded-For is honoured ONLY when the TCP peer is inside NZT_TRUSTED_PROXY_CIDRS.
Then the chain is walked right-to-left skipping trusted hops; the first untrusted
address is the client. Default (no CIDRs) => the socket peer, headers ignored."""

from __future__ import annotations

import ipaddress
from collections.abc import Sequence

from starlette.requests import Request

IPNetwork = ipaddress.IPv4Network | ipaddress.IPv6Network
IPAddress = ipaddress.IPv4Address | ipaddress.IPv6Address

_UNKNOWN = "0.0.0.0"  # noqa: S104 - placeholder for audit rows when no peer is known


def _parse_ip(value: str) -> IPAddress | None:
    value = value.strip()
    if value.startswith("[") and "]" in value:  # [v6]:port
        value = value[1 : value.index("]")]
    elif value.count(":") == 1:  # v4:port
        value = value.split(":", 1)[0]
    try:
        return ipaddress.ip_address(value)
    except ValueError:
        return None


class ClientIPResolver:
    def __init__(self, trusted_cidrs: Sequence[str]) -> None:
        self._trusted: tuple[IPNetwork, ...] = tuple(
            ipaddress.ip_network(c, strict=False) for c in trusted_cidrs
        )

    def _is_trusted(self, ip: IPAddress) -> bool:
        return any(ip in net for net in self._trusted)

    def resolve(self, peer: str | None, forwarded_for: str | None) -> str:
        peer_ip = _parse_ip(peer) if peer else None
        if peer_ip is None:
            return _UNKNOWN
        if not self._trusted or not self._is_trusted(peer_ip) or not forwarded_for:
            return str(peer_ip)
        candidate: IPAddress = peer_ip
        for raw in reversed(forwarded_for.split(",")[:32]):
            hop = _parse_ip(raw)
            if hop is None:
                # Garbage in the chain: stop at the last address we could trust.
                return str(candidate)
            candidate = hop
            if not self._is_trusted(hop):
                return str(hop)
        return str(candidate)

    def for_request(self, request: Request) -> str:
        peer = request.client.host if request.client else None
        return self.resolve(peer, request.headers.get("x-forwarded-for"))
