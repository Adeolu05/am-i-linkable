# Prior art

## Academic research on round-trip linkage

### Quesnelle, "On the linkability of Zcash transactions" (2017)

Jeffrey Quesnelle, arXiv:1712.01210. Defines *round-trip* transactions: coins
sent from a transparent address into the shielded pool, followed soon after by
an identical or nearly identical amount coming back out to a transparent
address. Using data up to block 196,304 (October 2017), the paper estimates that
**31.5% of coins sent to shielded addresses** were likely part of a round trip,
which largely removes their unlinkability. To limit false positives it focuses
on amounts that are unique across the chain.

- Paper: <https://arxiv.org/abs/1712.01210>
- Author's write-up: <https://jeffq.com/blog/on-the-linkability-of-zcash-transactions/>

### Kappos, Yousaf, Maller, Meiklejohn, "An Empirical Analysis of Anonymity in Zcash" (USENIX Security 2018)

A broader study of how the shielded pool was used. Heuristics that attribute
deposits and withdrawals to founders and miners linked **65.6%** of the value
withdrawn from the pool; a general heuristic for linking other deposit and
withdrawal pairs added a further 3.5%. Together they reduced the anonymity set
by **69.1%**. The authors also found that relatively little can be inferred from
transactions that stay inside the shielded pool.

- Paper: <https://www.usenix.org/conference/usenixsecurity18/presentation/kappos>
- Preprint: <https://arxiv.org/abs/1805.03180>

### What we take from this work

Both papers show that the transparent <-> shielded boundary, not the shielded
pool itself, is where most linkage happens, and that amount plus timing is the
main signal. Both are retrospective analyses run by researchers over the whole
chain. Neither gives an individual user a way to check their own exposure
before or after they move funds.

## payments-gateway: Zcash amount-privacy advisor

[payments-gateway](https://glama.ai/mcp/servers/Rotwang9000/payments-gateway)
(Rotwang9000, MIT licensed) is a payments gateway that runs as both an MCP
server and a REST API. Among other features it offers a free Zcash
amount-privacy advisor: "blend in" advice for shield and deshield amounts, a
round-trip warning, a split planner for large amounts, and an on-chain
popular-amount index. Its public listing documents these REST endpoints:

- `GET /v1/zec/amount-advice`
- `GET /v1/zec/split-plan`
- `GET /v1/zec/popular-amounts`

with equivalent MCP tools (`zec_amount_advice`, `zec_split_plan`,
`zec_popular_amounts`).

Because advice is served by a REST API, the client asks the server about the
amount it is considering, so whoever operates that server receives the queried
amount (and, at the network layer, the requester's IP address). The project is
open source and self-hostable, which lets a user run their own instance to avoid
this; live counts need a Zebra node and its index poller.

## How Am I Linkable? differs

| | Research papers | payments-gateway advisor | Am I Linkable? |
|---|---|---|---|
| Audience | Researchers | Gateway operators, REST and MCP clients | Ordinary Zcash users |
| Where matching runs | Researcher's machine | Server | **User's browser** |
| What the operator learns | n/a | The queried amount (unless self-hosted) | Neither the amount nor the address |
| Check a planned move | No | Yes | Yes ("Before you move") |
| Check a past address | Not per user | No | Yes, via a k-anonymous range query |
| Public aggregate stats | In the paper | Popular-amount index | Yes ("Pool weather") |
| Covers Ironwood | No (pre-date it) | Not stated in the listing | Yes |

The three differences that matter:

1. **Client-side matching.** The planned amount is compared against a dataset
   that is identical for every visitor, entirely in the browser.
2. **k-anonymity address check.** Inspired by HaveIBeenPwned's Pwned
   Passwords range API: only a short SHA-256 prefix leaves the device, the whole
   bucket comes back, and the bucket size (the anonymity set) is published.
3. **Built for ordinary users.** Plain-language results, a risk indicator
   rather than a forensic report, and no wallet, account or keys involved.
