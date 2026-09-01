## What this changes

<!-- What it does and why. If it fixes an issue, link it. -->

## How you know it works

<!--
The two habits this repo keeps:

  * A fix ships with a test you have watched FAIL against the old code — not
    one that merely passes now.
  * A rendering change is checked in a real browser. jsdom has no layout, so
    clipped labels and contrast problems are invisible to it.

Say which applies and what you saw.
-->

## Checks run locally

```
pnpm build
pnpm test
node packages/cli/dist/bin.js validate examples/sales-overview.gw.yaml --data
node packages/cli/dist/bin.js validate examples/orders-star.gw.yaml --data
pnpm --filter @gridwright/playground build
```

- [ ] All of the above pass
- [ ] Dependencies still point one way through the package list
- [ ] Manifest format unchanged, or a migration is included
