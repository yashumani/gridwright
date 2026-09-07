# @gridwright/coordinator

A capability gate and a bounded run — deterministic enforcement at the tool boundary, and one parent that cannot spawn a second.

```bash
pnpm add @gridwright/coordinator
```

Scope is frozen into the invocation before the call and the result is classified again on the way back, because a capability that was allowed to run is not a result that is allowed to leave. A privileged call with no reachable policy fails closed. One run owns one budget, cancellation reaches a call already in flight, and a specialist has no way to start another run.

- [Documentation](https://github.com/yashumani/gridwright/tree/main/docs)
- [Readiness report](https://github.com/yashumani/gridwright/blob/main/docs/project/READINESS.md) — what is proven and what is merely built
- [Contributing](https://github.com/yashumani/gridwright/blob/main/CONTRIBUTING.md)
- [Security policy](https://github.com/yashumani/gridwright/blob/main/SECURITY.md)

MIT © [yashumani](https://github.com/yashumani)
