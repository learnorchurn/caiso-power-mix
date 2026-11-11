# Origin of this focused extraction

The source is Richard Couch's Live Data Lab. Its existing public power view is available at https://www.richcouch.com/lab/index.html#power.

| Source component | Source blob SHA at extraction | Treatment |
| --- | --- | --- |
| `public/lab/app.js` | `ce87f6bfd0b0673fa71356cb2f0636a4814a7b22` | Retained the power-rendering functions; replaced the three-view loader and URL handling with focused equivalents. |
| `public/lab/index.html` | `6ce7b5d631b250d37a50cd58a069e721fcf89e1e` | Retained the power panel and existing role/verification disclosures; added a standalone page introduction and explicit saved-snapshot notice. |
| `public/lab/styles.css` | `9327e9fddb7f7278fea7b23c84f6b3487c5cbbf4` | Used the original visual vocabulary; replaced the three-view stylesheet with a focused responsive stylesheet using local system fonts. |
| `scripts/lab/fetch_power.py` | `f13301b8f0c865ae8c11cf641024a400bdab29af` | Copied without changing its data retrieval or validation logic. |
| `public/lab/data/power.json` | `e5a7962f78e55d97a57e578c74b9b04a43abc61f` | Copied unchanged as the dated source snapshot. |

The original site identifies Richard's role as selecting the topics, setting the audience and cost constraints, and directing the design and usability brief. It identifies Codex's role as implementing the pipelines and interfaces and running checks. This package retains that distinction.

This is a separate snapshot for portfolio review. It is not connected to the production repository's automatic refresh or deployment workflow. Its source data can be refreshed manually using the included script. No scheduled Actions workflow, site analytics, private configuration, or unrelated datasets are included.

