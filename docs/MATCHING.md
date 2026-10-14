# Matching: how "Before you move" scores an amount

Status: v1, 2026-10-14. Code: `packages/core/src/match.ts` (pure, no I/O, runs in
the browser). Results are a **risk indicator, not proof**: they say a withdrawal
*may be linkable*, never that anyone *is linked*.

## The question

You plan to withdraw (unshield) **P** ZEC from a shielded pool to a transparent
address. Could someone pair that withdrawal with the deposit (shield) that
funded it, using only public amounts and timing?

## Inputs

- **P**, as typed. It is converted to zatoshis with exact string arithmetic
  (`parseZecToZat`): no floating point, at most 8 decimal places, never above
  the 21M ZEC supply.
- **Now**, the current time.
- **Recent deposits**: every non-dust shield event from the last 30 days
  (`GET /api/v1/shields`; identical for every visitor). P itself never leaves
  the browser.

## Signals

1. **Exact matches**: deposits of exactly P.
2. **Near matches**: deposits X with `0 < X - P <= 100,000 zat`. A withdrawal of
   P takes P plus the fee out of the pool, so a deposit slightly larger than P
   can fund it.
3. **Anonymity set**: the number of deposits matching exactly or near
   (`P <= X <= P + 100,000 zat`). This is the crowd the withdrawal blends into.
4. **Recency**: how long ago the newest matching deposit happened.

### Why the fee band is 100,000 zat (0.001 ZEC)

From 30 days of mainnet turnstile events (2026-09-14 to 2026-10-14, 43,497
non-dust unshields), the transaction fee was:

| Percentile | Fee (zat) |
|---|---:|
| median | 15,000 |
| 90th | 30,000 |
| 95th | 50,000 |
| 99th | **100,000** |

The band is set at the 99th percentile. A tighter band (for example the 95th
percentile, 50,000) would miss some genuine pairs, giving false comfort. That is
worse than a slightly larger crowd. The band also leaves room for a fee or two
for shielded transfers between the deposit and the withdrawal.

## Scoring

| Anonymity set | Newest match within 7 days | Older than 7 days |
|---|---|---|
| 0 | low | low |
| 1–2 | **high** | medium |
| 3–9 | medium | low |
| 10 or more | low | low |

- 10 or more deposits in the band: the withdrawal blends in, and an observer
  cannot tell which deposit funded it.
- 1–2 deposits: an amount match narrows it to one or two candidates.
- 7 days: timing correlation weakens as the gap grows, but it does not vanish.

## Suggestions

Suggestions are shown only when the risk is medium or high.

- **Wait**: the same rule re-applied 1, 3, 7, 14 and 30 days from now (the
  matching deposits are kept; only their age changes). Shown only if waiting
  changes the level.
- **Use a common amount instead**: amounts at or below P (down to half of P)
  whose anonymity set is at least 10. Candidates are the deposit amounts seen
  in that range, each of them minus the typical 15,000-zat fee, and round
  numbers (such as 4.0, 4.9, 4.99). Candidates within one fee band of each
  other describe the same crowd, so each group gives one suggestion: the
  roundest amount that keeps at least 80% of the group's largest crowd. The
  three largest crowds are shown.
- **Split**: up to three parts, each with an anonymity set of at least 10,
  together covering at least 95% of P (the remainder stays shielded). Offered
  only if no single common amount within 5% of P exists, because one common
  amount is simpler and leaks less. Parts should be sent hours or days apart,
  to different addresses; parts sent together can be added back up.

**Dust** (P at or below 0.001 ZEC) returns: *"This amount is too small and
common to match meaningfully."*

## Limits (please read)

- **Only 30 days of deposits.** Someone with full chain history can match a
  unique amount from months ago. Waiting weakens *timing* links, not *amount*
  links.
- **Amounts and timing only.** It ignores other signals: address reuse, wallet
  fingerprints (fees, output counts, expiry heights), network-level
  observation, exchange records, and any knowledge an observer has about you.
- **Deposits only.** It does not model chains of shielded hops, pool
  migrations, or withdrawals split across several transactions.
- **No user-specific knowledge.** It cannot know which deposit was yours. A high
  result may come from someone else's deposit that happens to match.
- **Fixed thresholds.** The band (100,000 zat), the crowd size (10) and the
  recency cut-off (7 days) are simple, documented choices, not statistical
  guarantees.

A low result does not guarantee privacy. A high result means a public pattern
exists, not that anyone has linked you.
