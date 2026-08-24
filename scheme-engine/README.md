# dbot-scheme-engine

Deterministic DCPR 2034 scheme-eligibility engine — the "Scheme Engine" layer
in DBOT Land Intelligence's architecture:

```
Parcel Engine → DP Engine → Authority Engine → Scheme Engine → FSI Engine → ...
```

Pure functions only. No GIS fetching, no database, no LLM in the decision
path — rules decide, AI explains afterward. Standalone and independently
testable, per the project brief: both `dbot-landwise` and any future
consumer (e.g. ai.dbot.in) can import this without duplicating logic.

## API

```js
import { evaluateScheme, evaluateAllSchemes, listSchemes, SCHEME_STATUS } from 'dbot-scheme-engine';

listSchemes();
// [{ id: 'REG_30A', title: '...', regulation: '30(A)', researchStatus: 'confirmed', researchNote: '...' }, ...]

evaluateScheme('REG_30A', parcelFacts, buildingFacts);
// { schemeId, title, evaluatedAt, status, reasons, sources, data }

evaluateAllSchemes(parcelFacts, buildingFacts); // every registered scheme, same facts
```

Every result follows the four-state verdict from the brief — never a binary
yes/no:

| `SCHEME_STATUS` | Meaning |
|---|---|
| `ELIGIBLE` 🟢 | All known conditions satisfied |
| `POTENTIALLY_ELIGIBLE` 🟡 | Some conditions satisfied, evidence missing |
| `NOT_ELIGIBLE` 🔴 | Known facts contradict the scheme |
| `NOT_EVALUABLE` ⚪ | Insufficient information — including "we don't have the regulation text yet" |

Every result carries a `sources` array (`{ value, source_type,
source_url_or_document, retrieved_at, confidence }`) so a verdict is never a
black-box number — this is what makes the output usable in an institutional
lender pack.

## Honest state of the 5 registered schemes — read before trusting this

The project brief listed 5 schemes as "already confirmed" (30(A), 33(5),
33(7), 33(7)(A), 33(7)(B)) and suggested starting the Scheme Engine narrow
with just those. Cross-checking against the actual
`DCPR_2034_Regulation_Reference.md.pdf` in this repo, **that's only true for
one of them**:

| Scheme | Status in this engine | Why |
|---|---|---|
| `REG_30A` (Regulation 30(A), Island City) | **Real, computes actual FSI numbers** | The Island City Residential/Commercial road-width table, the Industrial flat rate, and the BARC special case are genuinely sourced from the sanctioned DCPR 2034 document and cross-checked against 3 independent sources. Suburbs is explicitly `NOT_EVALUABLE` — the Suburbs table has two conflicting secondary sources (1.00 flat vs. 1.08 for roads under 9m) and neither has been checked against primary text. |
| `REG_33_5` | Stub — always `NOT_EVALUABLE` | Doesn't even appear in the reference doc's confirmed table of contents. The brief's "confirmed" label for this one isn't backed by the sourced document. |
| `REG_33_7` | Stub — always `NOT_EVALUABLE` | Subject confirmed from the TOC; eligibility conditions and FSI formula are explicitly listed as **not yet pulled from source text**. |
| `REG_33_7A` | Stub — always `NOT_EVALUABLE` | Same as above. |
| `REG_33_7B` | Stub — always `NOT_EVALUABLE` | Same as above, plus one extra wrinkle: a *partial, unconfirmed* recall exists ("10 sq.m per member or 15% of authorised BUA, whichever is more, for societies older than 30 years"), but the reference doc itself flags this as unverified. It's recorded in the module as a visible-but-unused note (`reg33_7B.js`), never fed into the verdict. |

The stub schemes are not placeholders in the "not implemented yet" sense —
they are **structurally complete and wired into the engine**, ready to have
real condition logic dropped in the moment primary clause text is sourced
for each regulation. Until then, returning `NOT_EVALUABLE` with a clear
reason is the correct behavior, not a gap in this module: fabricating
eligibility conditions from a paraphrase or partial recall would violate
the project's own core rule (`null`/`NOT_EVALUABLE` is preferred over a
guessed value, especially in an institutional-lender context).

**Next step for these 4 schemes lives in the regulation-research track, not
here** — see the brief's "Prioritized next steps," item 1. Once a scheme's
primary clause text is pulled and cross-checked, replace its `evaluate()`
body with real condition logic (following the pattern in `reg30A.js`),
flip `meta.researchStatus` to `'confirmed'`, and update/replace
`test/stubSchemes.test.js`'s fixture list to drop that scheme from the
"never returns a verdict" guard.

## Fact shapes this engine expects

Not enforced by a schema (no dependency added for that) — documented here
and in each scheme's JSDoc `@param` instead.

**`parcelFacts`** — derivable from `dbot-dp-engine` / `dbot-landwise`
output, `null` where genuinely not yet auto-derived upstream:
```js
{
  areaSqm: number | null,
  zoneClassification: 'ISLAND_CITY' | 'SUBURBS' | 'EXTENDED_SUBURBS' | null,
  dpZoneUse: 'RESIDENTIAL_COMMERCIAL' | 'INDUSTRIAL' | null,
  roadWidthM: number | null,   // abutting road width — not yet auto-derived upstream (see landFacts.js)
  isBARCArea: boolean | null,  // M Ward BARC-earmarked special case
}
```

**`buildingFacts`** — per the brief, *never* derivable from GIS, always
user input (the "Additional Land Details" / "Project Details" UI screens):
```js
{
  buildingAgeYears: number | null,
  isCessed: boolean | null,
  tenantOccupancyCount: number | null,
  isSocietyRegistered: boolean | null,
  ownershipType: string | null,
  developmentType: 'GREENFIELD' | 'REDEVELOPMENT' | null,
}
```

## Testing

```bash
npm test   # node --test — no test framework dependency, matches the rest of this repo
```

19 tests: full coverage of Regulation 30(A)'s road-width bands, the
Industrial/BARC special cases, the Suburbs data-gap path, the fungible-area
helper, and a guard test asserting the 4 stub schemes never fabricate a
🟢/🔴 verdict under any input.
