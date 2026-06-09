# EstaCoda WhatsApp Bridge

This directory is a standalone npm package for the WhatsApp transport helper.

The root EstaCoda runtime must not install or import `@whiskeysockets/baileys` or
WhatsApp/Baileys-specific `@hapi/boom` handling. Those dependencies live here so
the unofficial WhatsApp transport is quarantined from the main runtime.

This package is intentionally not part of the root pnpm workspace. Install bridge
dependencies from this directory only:

```bash
cd scripts/whatsapp-bridge
npm ci
```

Current scope:

- Own Baileys socket construction.
- Own Baileys/Boom disconnect classification.
- Keep socket defaults local to the bridge:
  - `syncFullHistory: false`
  - `markOnlineOnConnect: false`
  - `browser: ["EstaCoda", "Chrome", "120.0"]`
  - `fetchLatestBaileysVersion()`
  - `getMessage`

Not implemented in this commit:

- bridge lifecycle manager
- HTTP API server
- QR wizard
- secure user pairing
- self-chat
- groups
- media/voice parity

The main runtime should interact with this package only through normalized bridge
events and errors. It should never receive Baileys socket objects or Boom-shaped
disconnect errors.
