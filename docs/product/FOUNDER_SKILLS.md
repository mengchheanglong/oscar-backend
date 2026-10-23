# Founder skill pack in OSCAR

Source: <https://github.com/Jakeschincariol/founder-skill>

Pinned revision: `fd9385b0cfe1b96bebce3898fbd506d73eff5a9d`.
Author: Jake Schincariol. License: MIT; the complete upstream notice is preserved
in each installed entry. The checkout lives locally at
`runtimes/skills/founder-skill` under the OSCAR workspace, outside either app repo.

The main OSCAR account has all 11 modes in **Customize → Skills**:

| Command                | Purpose                                   |
| ---------------------- | ----------------------------------------- |
| `/founder-board`       | Offers, Monopoly, and Product lens review |
| `/founder-competitors` | Competitor evidence and positioning       |
| `/founder-consumer`    | Clearly labeled buyer simulations         |
| `/founder-pricing`     | Price sensitivity and candidate prices    |
| `/founder-offer`       | Offer design and objections               |
| `/founder-cfo`         | Unit economics and financial inputs       |
| `/founder-marketing`   | Positioning, channels, and campaigns      |
| `/founder-brand`       | Naming, voice, and visual brief           |
| `/founder-ops`         | Suppliers, staffing, routines, and risk   |
| `/founder-launch`      | Real demand test and launch planning      |
| `/founder-plan`        | Evidence-based business plan compilation  |

Start with `/founder-board` followed by an idea, target customer, product, price,
and any constraints. Each command attaches its mode to that chat, using the normal
shared-skill lifecycle. A chat supports four attachments; remove older modes when
switching through a longer workflow. Other connected workspaces can read the
entries through `list_skills` and `get_skill` on OSCAR MCP.

## Installation boundary

This is an **instruction-mode** import. The complete upstream SKILL.md texts are
preserved, with board/offer lenses and relevant example input files embedded.
OSCAR compatibility guidance explains how to use conversation evidence and produce
draft artifacts when host tools are unavailable. Each entry retains its source,
revision, path, and license. No instructions were summarized to fit the former
4,000-character limit; the API, editor, and database now allow 12,000 characters.

The upstream Python scripts remain in the local source checkout. They are not
exposed as OSCAR/Hermes chat tools. No shell or sub-agent permission was added.
Only a connected workspace that actually exposes and authorizes those tools can
execute such workflows. Agents must not claim files were saved, calculations ran,
or independent buyer agents were launched when they only drafted text. Simulations
are not customer evidence, and missing calculations cannot produce a computed
profitability verdict.

## Reproduce

Clone the source into `runtimes/skills/founder-skill`. The installer reads exact
files from the pinned Git revision with `git show`; it does not execute source
scripts or rely on modified working-tree files. Set `OSCAR_API_KEY` privately to
the intended account's personal access token and set `OSCAR_API_URL` to the local
API (`http://127.0.0.1:3001/api/v1` or the frontend proxy on port 3002).

From the backend:

```sh
node scripts/install-founder-skills.cjs
# Optional argument: another local source checkout containing the pinned commit.
node --test scripts/install-founder-skills.test.cjs
```

All source entries are validated before any write. Re-running leaves identical
entries unchanged. Modified or user-authored command collisions are preserved and
reported rather than overwritten. Interrupted installs can be retried without
duplicating already installed entries. Credentials and installed account data are
not written to the repository.
