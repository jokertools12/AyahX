# AyahX research task template

Use in a separately configured AutoGPT instance. This template does not start
an agent, grant credentials, or connect AutoGPT to AyahX.

Goal: research a named engineering question using public official documentation.
Return a report with source URLs, verified facts, uncertain claims and suggested
next steps. Do not write code, run commands, make purchases, deploy, send
messages or access private files. Do not generate canonical Quran text or
alignment timings. Require the operator to choose provider/model and spending
limits in AutoGPT itself. A human reviews the report before implementation.

Never mount AyahX's repository, .env files, uploads or credential directories
into AutoGPT. Use a separate scratch directory with public inputs only.
