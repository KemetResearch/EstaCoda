# Install EstaCoda

## One-line install (recommended)

```bash
curl -fsSL https://estacoda.kemetresearch.com/install.sh | bash
```

This will:
- Detect your OS and architecture
- Check for Bun (required)
- Install the `estacoda` binary into `~/.estacoda/bin/`
- Add `~/.estacoda/bin` to your shell PATH

After install, restart your shell or run:

```bash
export PATH="$HOME/.estacoda/bin:$PATH"
```

## Manual install

### Prerequisites
- Bun >= 1.0

### Steps

1. Clone the repository:
   ```bash
   git clone https://github.com/kemetresearch/estacoda.git
   cd estacoda
   ```

2. Run the install script:
   ```bash
   bash scripts/install.sh
   ```

3. Or use the wrapper directly:
   ```bash
   bash scripts/estacoda-wrapper.sh --version
   ```

## Post-install

```bash
estacoda init       # Bootstrap state directories
estacoda verify     # Check readiness
estacoda            # Start interactive session
```

## Update

```bash
estacoda update          # Dry-run: see what would update
estacoda update --apply  # Apply update (requires ESTACODA_UPDATE_ARTIFACT)
```

## Troubleshooting

**Bun not found**: Install Bun from https://bun.sh/docs/installation

**No prebuilt binary**: The v0.1.0 installer falls back to a Bun-backed wrapper. This is expected.
