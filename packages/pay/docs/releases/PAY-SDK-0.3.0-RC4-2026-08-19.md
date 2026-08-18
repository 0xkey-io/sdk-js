# Pay SDK 0.3.0-rc.4 release evidence

Date: 2026-08-19

## Published package

- Package: `@0xkey-io/pay@0.3.0-rc.4`
- Merged source SHA: `6fa24b5d7f060f484a6c744635ad339760c89b4b`
- npm shasum: `d4a5aad75622680a0c5900bf40952760af8e8406`
- npm integrity: `sha512-VnWqfFKW4JAZVjRif9fVNgbDSgaq1XVfExvcZdenqooywrYeD+gugQdt2/d0XmUEOoDBB5zDMQ3gZn7mOOHT5Q==`
- npm `next`: `0.3.0-rc.4`
- npm `latest`: `0.2.0`

## Merged release inputs

- Task 1 merge: `875b6f133d122f3e2d13525ad0e4ab78981354e6` (PR #31)
- Release source and workflow merge: `fd982c8413ac4152b4f888f007957a9e462c3944` (PR #32)
- Dependency-build fix merge: `6fa24b5d7f060f484a6c744635ad339760c89b4b` (PR #33)
- Exact protocol pins: `mppx@0.8.17`; `@x402/*@2.22.0`

## CI and publish evidence

### Final release SHA

All runs in this table covered final release SHA
`6fa24b5d7f060f484a6c744635ad339760c89b4b`.

| Run | Result | Evidence |
| --- | --- | --- |
| js-build | passed | [run 32190412624](https://github.com/0xkey-io/sdk-js/actions/runs/32190412624) |
| meta | passed | [run 32190412691](https://github.com/0xkey-io/sdk-js/actions/runs/32190412691) |
| Pay-only publish | failed verification-after-publish | [run 32190440464](https://github.com/0xkey-io/sdk-js/actions/runs/32190440464) |

The Pay-only publish run completed pins, docs, typecheck, 57 tests, build,
interop, pack, and publication successfully on the final release SHA. Only its
immediate registry verification failed, due to transient npm propagation.

### PR #32 head SHA

These runs covered PR #32 head SHA
`3a46c8e48a11ff224934292d6164b576fd9a6053`, not the final release SHA.

| Run | Result | Evidence |
| --- | --- | --- |
| js-build | passed | [run 32188445955](https://github.com/0xkey-io/sdk-js/actions/runs/32188445955) |
| pay-v1 | passed | [run 32188445994](https://github.com/0xkey-io/sdk-js/actions/runs/32188445994) |
| Commerce contract | passed | [run 32188445967](https://github.com/0xkey-io/sdk-js/actions/runs/32188445967) |
| Commerce verifier | passed | [run 32188445996](https://github.com/0xkey-io/sdk-js/actions/runs/32188445996) |
| meta | passed | [run 32188446200](https://github.com/0xkey-io/sdk-js/actions/runs/32188446200) |

- Independent registry checks seconds later verified the published version,
  shasum, integrity, `next`, and `latest` values above.

## Workflow conclusion

The workflow is recorded as **failed verification-after-publish**, not as a
clean green run. The package publication itself succeeded.
