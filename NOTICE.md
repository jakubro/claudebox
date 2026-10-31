# Third-Party Notices

Claudebox is distributed as source under the [GNU GPL v3](LICENSE). This repository contains no third-party code: dependencies are fetched from npm, PyPI, the Ubuntu archive, and upstream release pages by the machine that builds and installs it.

Two artifacts built from this source do embed third-party components — the web interface bundle (`npm run build`) and the container image (`claudebox build`). This file records the notices that must accompany those artifacts if you redistribute them.

## Fonts

The web interface bundle self-hosts two typefaces, both licensed under the [SIL Open Font License 1.1](https://openfontlicense.org/). Neither reserves a font name.

- **Inter** — Copyright 2016 The Inter Project Authors (https://github.com/rsms/inter)
- **JetBrains Mono** — Copyright 2020 The JetBrains Mono Project Authors (https://github.com/JetBrains/JetBrainsMono)

It also self-hosts **DejaVu Sans** and **DejaVu Sans Mono** (https://dejavu-fonts.github.io/) for the symbols those two typefaces do not cover. DejaVu's changes are in the public domain; the glyphs it inherits carry the Bitstream Vera and Arev licences, reproduced here as both require.

```
Fonts are (c) Bitstream (see below). DejaVu changes are in public domain.
Glyphs imported from Arev fonts are (c) Tavmjong Bah (see below)


Bitstream Vera Fonts Copyright
------------------------------

Copyright (c) 2003 by Bitstream, Inc. All Rights Reserved. Bitstream Vera is
a trademark of Bitstream, Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of the fonts accompanying this license ("Fonts") and associated
documentation files (the "Font Software"), to reproduce and distribute the
Font Software, including without limitation the rights to use, copy, merge,
publish, distribute, and/or sell copies of the Font Software, and to permit
persons to whom the Font Software is furnished to do so, subject to the
following conditions:

The above copyright and trademark notices and this permission notice shall
be included in all copies of one or more of the Font Software typefaces.

The Font Software may be modified, altered, or added to, and in particular
the designs of glyphs or characters in the Fonts may be modified and
additional glyphs or characters may be added to the Fonts, only if the fonts
are renamed to names not containing either the words "Bitstream" or the word
"Vera".

This License becomes null and void to the extent applicable to Fonts or Font
Software that has been modified and is distributed under the "Bitstream
Vera" names.

The Font Software may be sold as part of a larger software package but no
copy of one or more of the Font Software typefaces may be sold by itself.

THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT OF COPYRIGHT, PATENT,
TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL BITSTREAM OR THE GNOME
FOUNDATION BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, INCLUDING
ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL DAMAGES,
WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF
THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM OTHER DEALINGS IN THE
FONT SOFTWARE.

Except as contained in this notice, the names of Gnome, the Gnome
Foundation, and Bitstream Inc., shall not be used in advertising or
otherwise to promote the sale, use or other dealings in this Font Software
without prior written authorization from the Gnome Foundation or Bitstream
Inc., respectively. For further information, contact: fonts at gnome dot
org.

Arev Fonts Copyright
------------------------------

Copyright (c) 2006 by Tavmjong Bah. All Rights Reserved.

Permission is hereby granted, free of charge, to any person obtaining
a copy of the fonts accompanying this license ("Fonts") and
associated documentation files (the "Font Software"), to reproduce
and distribute the modifications to the Bitstream Vera Font Software,
including without limitation the rights to use, copy, merge, publish,
distribute, and/or sell copies of the Font Software, and to permit
persons to whom the Font Software is furnished to do so, subject to
the following conditions:

The above copyright and trademark notices and this permission notice
shall be included in all copies of one or more of the Font Software
typefaces.

The Font Software may be modified, altered, or added to, and in
particular the designs of glyphs or characters in the Fonts may be
modified and additional glyphs or characters may be added to the
Fonts, only if the fonts are renamed to names not containing either
the words "Tavmjong Bah" or the word "Arev".

This License becomes null and void to the extent applicable to Fonts
or Font Software that has been modified and is distributed under the
"Tavmjong Bah Arev" names.

The Font Software may be sold as part of a larger software package but
no copy of one or more of the Font Software typefaces may be sold by
itself.

THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL
TAVMJONG BAH BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.

Except as contained in this notice, the name of Tavmjong Bah shall not
be used in advertising or otherwise to promote the sale, use or other
dealings in this Font Software without prior written authorization
from Tavmjong Bah. For further information, contact: tavmjong @ free
. fr.
```

## Apache License 2.0

The following components are licensed under the [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0) and ship a NOTICE file, reproduced here as section 4(d) requires.

**aiofiles**

```
Asyncio support for files
Copyright 2016 Tin Tvrtkovic
```

**argcomplete**

```
argcomplete is a free open source library that integrates Python applications with Bash and Zsh shell completion.
The argcomplete project is staffed by volunteers. If you are using this library in a for-profit project, please
contribute to argcomplete development and maintenance using the "Sponsor" button on the argcomplete GitHub project page,
https://github.com/kislyuk/argcomplete.
```

**requests**

```
Requests
Copyright 2019 Kenneth Reitz
```

Further Apache-2.0 components carry no NOTICE file of their own: `python-multipart`, `tenacity`, `distro`, `opentelemetry-api`, `chevrotain` and its `@chevrotain/*` packages, and the Playwright and Podman toolchains. `structlog` is offered under MIT or Apache-2.0; Claudebox elects MIT.

## Mozilla Public License 2.0

Source files under MPL-2.0 reach the built artifacts through `certifi`, `pathspec`, and `orjson`. MPL-2.0 is file-level copyleft: the source of those files must remain available to recipients, and each upstream project publishes it. `orjson` and `pathspec` additionally offer parts of their code under permissive terms.

## Eclipse Public License 2.0

`elkjs`, the layout engine Mermaid draws some diagrams with, reaches the web interface bundle under the [Eclipse Public License 2.0](https://www.eclipse.org/legal/epl-2.0/). A redistributed bundle must tell its recipients where the source of that component can be obtained; the upstream project publishes it at https://github.com/kieler/elkjs.

## BSD licenses

Redistribution in binary form requires reproducing the copyright notice and disclaimer of each of these components. Their notices live in their published packages.

- **BSD 3-Clause** — `httpx`, `httpcore`, `httpx2`, `httpcore2`, `starlette`, `uvicorn`, `sse-starlette`, `websockets`, `python-dotenv`, `click`, `idna`, `nbformat`, `jupyter-core`, `traitlets`, `fastjsonschema`, `jsonpatch`, `jsonpointer`, `zstandard`, `uuid-utils`, `colorama`, `lxml`; `highlight.js`, `diff` (jsdiff), and the `d3-*` modules used by Mermaid
- **BSD 2-Clause** — `pygments`, `xxhash`, `entities`, `leaflet`

## Permissive remainder

The rest of the dependency graph is MIT, ISC, PSF-2.0, MIT-0, 0BSD, Zlib, CC0-1.0, or Unlicense. Each package carries its own license text in its published artifact. The authoritative, version-exact inventory is the lockfiles in this repository: `uv.lock`, `package-lock.json`, `src/claudebox_frontend/package-lock.json`, and `e2e/app/package-lock.json`.

## Components this repository does not license to you

A container image built from this source contains software Claudebox has no right to redistribute on your behalf. Building it locally is what the license terms below contemplate; republishing the resulting image is not.

- **Claude Code CLI** (`@anthropic-ai/claude-code`, and the copy bundled inside the `claude-agent-sdk` wheel) — proprietary, all rights reserved, governed by [Anthropic's Commercial Terms of Service](https://www.anthropic.com/legal/commercial-terms). No right to copy or redistribute is granted.
- **Ubuntu base image and apt userland** — an aggregate of GPL-2.0, GPL-3.0, LGPL, and permissive packages. Redistribution carries corresponding-source obligations, and Canonical's [IPRights Policy](https://ubuntu.com/legal/intellectual-property-policy) restricts use of the Ubuntu trademarks on a modified image.
- **Caddy** — Apache-2.0; "Caddy" is a registered trademark of Stack Holdings GmbH.

Web-search and model-provider backends are services, not bundled code. Each is governed by its own terms, accepted by whoever supplies the credentials: Anthropic, DuckDuckGo, Tavily, Brave, and the providers reachable through LangChain.
