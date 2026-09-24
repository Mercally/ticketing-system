# ADR-0002: Seat Consistency Strategy

## Status
Accepted

## Context
The single hardest correctness requirement in the system: two buyers must never both successfully reserve or buy the same seat, even with millions of concurrent requests at the moment a popular concert goes on sale. The prompt explicitly forbids using Redis (or any cache) as the authority for seat exclusivity, and explicitly requires the guarantee to come from PostgreSQL, via constraints, optimistic/pessimistic concurrency, or an atomic `UPDATE` — whichever fits best.

## Decision
Use a single **atomic conditional `UPDATE`** (a SQL-level compare-and-swap) as the entire concurrency control mechanism for seat state transitions. No `SELECT ... FOR UPDATE`, no application-level locks, no distributed locks.

```sql
-- Reserve
UPDATE seats
SET status = 'RESERVED', reservation_id = @reservationId, reserved_until = now() + @ttl, updated_at = now()
WHERE id = @seatId
  AND (status = 'AVAILABLE' OR (status = 'RESERVED' AND reserved_until < now()));
-- rows affected = 1  => reservation succeeded
-- rows affected = 0  => seat unavailable (already reserved by someone else, or sold)

-- Confirm (RESERVED -> SOLD), only by the reservation holder
UPDATE seats
SET status = 'SOLD', updated_at = now()
WHERE id = @seatId AND reservation_id = @reservationId AND status = 'RESERVED';

-- Release (RESERVED -> AVAILABLE), only by the reservation holder, or by TTL sweep
UPDATE seats
SET status = 'AVAILABLE', reservation_id = NULL, reserved_until = NULL, updated_at = now()
WHERE id = @seatId AND reservation_id = @reservationId AND status = 'RESERVED';
```

The application code inspects the affected-row count of that single statement and nothing else: `1` means this request won the race, `0` means it lost. Postgres's own row-level write lock inside a single `UPDATE` statement is the concurrency primitive — when N transactions target the same row concurrently, Postgres's MVCC serializes them at the storage engine level; exactly one commits the state change, the rest see the row as no longer matching the `WHERE` clause (either because it changed, or, under `READ COMMITTED`, they re-check the updated row and it no longer satisfies the predicate). No explicit application lock is taken because none is needed — the guarantee is intrinsic to a single-statement conditional write.

TTL expiry is folded directly into the same `WHERE` clause (`status = 'RESERVED' AND reserved_until < now()`) so an expired reservation is reclaimable by the very next reservation attempt with zero extra round-trips. A background hosted service additionally sweeps expired reservations back to `AVAILABLE` on a timer, purely so seat-map reads and SignalR broadcasts reflect expiry promptly even with no new reservation attempts — correctness never depends on the sweep running; it's a UX/observability nicety layered on top of a mechanism that's already correct without it.

`seats.id` is the primary key; `(event_id, seat_label)` carries a `UNIQUE` constraint as a structural last line of defense against ever inserting a duplicate seat row in the first place (distinct from the concurrency mechanism above, which governs state transitions on an existing row).

## Alternatives considered
- **Pessimistic locking (`SELECT ... FOR UPDATE`).** Works correctly, but under millions of concurrent requests for a small number of hot rows, it turns Postgres into a queue of blocked transactions waiting on row locks, with connection-pool exhaustion as the practical failure mode. The single-statement CAS achieves the same exclusivity without holding a transaction open across a round trip to application code.
- **Optimistic concurrency via a `version`/`xmin` column with read-then-write.** Requires two round trips (read version, then conditional update on that version) and a retry loop on conflict. The direct CAS collapses this to one round trip with no retry loop needed — the `WHERE status = 'AVAILABLE'` clause already is the version check, just expressed as the business state itself rather than an opaque counter.
- **Redis (e.g., `SETNX` or a distributed lock) as the reservation gate, with Postgres as later system of record.** Explicitly forbidden by the prompt, and for good reason: it introduces a second source of truth that can diverge from Postgres under partial failure (Redis says reserved, Postgres write never lands, or vice versa on failover), which is exactly the double-sell risk the whole system exists to prevent. Redis remains usable elsewhere in the system (ADR-0008) for concerns that tolerate eventual/approximate correctness — seat exclusivity does not.
- **Unique constraint on an `active_reservation` marker instead of a status column CAS.** Considered equivalent in spirit; the status-column CAS was chosen because it doubles as the natural seat-state representation the rest of the system already needs to read (`AVAILABLE`/`RESERVED`/`SOLD`), rather than adding a second structure to keep in sync with it.

## Trade-offs
- **Cost:** every reservation attempt is a real write against the hot seat row — under a genuine flash-sale spike this is exactly the workload Postgres row-level contention handles well (fast, short, single-statement transactions), but it does mean seat-row throughput has a ceiling tied to single-row write throughput. This is mitigated upstream by the Gateway's waiting room (ADR-0008), which caps how many reservation attempts reach Ticketing concurrently in the first place — the database is protected by admission control, not by making the database itself infinitely absorbent.
- **Benefit:** the correctness guarantee is trivial to state and trivial to test (exactly what `tests/Ticketing.ConcurrencyTests` does: N parallel attempts, assert exactly 1 success), because it rests entirely on well-understood single-statement ACID semantics rather than on coordinating multiple round trips or multiple systems.
- **Benefit:** no lock can be "left held" by a crashed process — there is no held lock, only committed or not-committed single statements.
