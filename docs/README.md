# Documentation

| Folder | Content | Changes when |
| ------ | ------- | ------------ |
| [developer-guide.md](developer-guide.md) | Per-person guide: what to read, where to work, what to hand over | Ownership or folders change |
| [plan/](plan/) | Scope, decisions (incl. Delivery 4 decisions), team & schedule, acceptance, risks | A plan decision changes (announce it) |
| [architecture/](architecture/) | Overview, flows, glossary, target vs. slice | Structure changes |
| [adr/](adr/) | Decisions taken *during* implementation that others must know | A non-trivial choice affects more than one unit |
| [runbooks/](runbooks/) | Operating the environment and running the demo | Operations change |
| [atlas/](atlas/README.md) | Platform Atlas: interactive map of every component, its decisions, GCP setup, dependencies and results ([index.html](atlas/index.html)) | A component, decision or result changes (rebuild with `build.py`) |
| [presentation/](presentation/README.md) | Delivery 4 defense, in Spanish: slide deck ([index.html](presentation/index.html)) and presenter console with notes, clock and operator commands ([presenter.html](presentation/presenter.html)) | The talk or a demo step changes |
| [evidence/](evidence/README.md) | What each Delivery 4 scenario did on `dev`: runs, numbers, screenshots, log queries | A scenario is re-run |
| [status/](status/) | What is done and what is missing for Delivery 4 | Daily while delivering |
| [design/](design/) | Original design deliverables (Spanish, read-only reference) | Never |

Normative contracts are **not** here: they live in [`../contracts/`](../contracts/).
