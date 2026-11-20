"""Client IP resolution with explicit proxy trust (D-A10).

X-Forwarded-For is honoured ONLY when the TCP peer is inside NZT_TRUSTED_PROXY_CIDRS.
Then the chain is walked right-to-left skipping trusted hops; the first untrusted
address is the client. Default (no CIDRs) => the socket peer, headers ignored.

Security notes (review M1/I2):
* Only the RIGHTMOST part of the chain is ever examined: those entries were appended by
  our own trusted proxies, while everything to their left is client-controlled. The walk
  stops at the first untrusted hop, so no number of forged entries on the left can
  influence the result (the old ``split(",")[:32]`` kept the LEFTMOST 32 entries and let
  a client push the real address out of the examined window).
* All ``X-Forwarded-For`` header lines are combined in order (RFC 9110 §5.3: multiple
  field lines == one comma-joined list), so an edge proxy that appends a new line
  instead of extending the existing one is handled correctly.
* At most ``MAX_FORWARDED_HOPS`` entries (from the right) are examined; a chain made of
  more trusted hops than that resolves to the leftmost examined hop (never to a
  client-chosen value further left)."""

from __future__ import annotations

import ipaddress
from collections.abc import Iterable, Sequence

from starlette.requests import Request

IPNetwork = ipaddress.IPv4Network | ipaddress.IPv6Network
IPAddress = ipaddress.IPv4Address | ipaddress.IPv6Address

_UNKNOWN = "0.0.0.0"  # noqa: S104 - placeholder for audit rows when no peer is known
MAX_FORWARDED_HOPS = 32
_MAX_HEADER_CHARS = 8192  # parsing budget: only the rightmost part is ever needed


def _parse_ip(value: str) -> IPAddress | None:
    value = value.strip()
    if value.startswith("[") and "]" in value:  # [v6]:port
        value = value[1 : value.index("]")]
    elif value.count(":") == 1:  # v4:port
        value = value.split(":", 1)[0]
    try:
        addr = ipaddress.ip_address(value)
    except ValueError:
        return None
    if isinstance(addr, ipaddress.IPv6Address) and addr.ipv4_mapped is not None:
        return addr.ipv4_mapped
    return addr


def _rightmost_hops(lines: Iterable[str]) -> list[str]:
    """Combine every header line (in order) and return at most MAX_FORWARDED_HOPS entries
    taken from the RIGHT end of the list."""
    joined = ",".join(lines)
    if len(joined) > _MAX_HEADER_CHARS:
        # Drop the (client-controlled) left part; a partial first token is discarded.
        joined = joined[-_MAX_HEADER_CHARS:].split(",", 1)[-1]
    return joined.split(",")[-MAX_FORWARDED_HOPS:]


class ClientIPResolver:
    def __init__(self, trusted_cidrs: Sequence[str]) -> None:
        self._trusted: tuple[IPNetwork, ...] = tuple(
            ipaddress.ip_network(c, strict=False) for c in trusted_cidrs
        )

    def _is_trusted(self, ip: IPAddress) -> bool:
        return any(ip in net for net in self._trusted)

    def resolve(self, peer: str | None, forwarded_for: str | Sequence[str] | None) -> str:
        peer_ip = _parse_ip(peer) if peer else None
        if peer_ip is None:
            return _UNKNOWN
        if not self._trusted or not self._is_trusted(peer_ip) or not forwarded_for:
            return str(peer_ip)
        lines = [forwarded_for] if isinstance(forwarded_for, str) else list(forwarded_for)
        candidate: IPAddress = peer_ip
        for raw in reversed(_rightmost_hops(lines)):
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
        return self.resolve(peer, request.headers.getlist("x-forwarded-for"))

    def for_rate_limit(self, request: Request) -> str:
        """Bucket IPv6 addresses to /64 so a subscriber cannot bypass per-IP limits by
        rotating interface-ID host bits."""
        ip = self.for_request(request)
        try:
            addr = ipaddress.ip_address(ip)
        except ValueError:
            return ip
        if isinstance(addr, ipaddress.IPv6Address):
            return str(ipaddress.IPv6Network((addr, 64), strict=False))
        return ip
