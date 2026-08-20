# Reboot Both Machines and Complete through Google Bridge

## Parent

Part of #32.

## What to build

Productize the private connection and startup behavior. The Google Cloud VM acts
only as an SSH jump host; supervised home and notebook tunnels plus the server
and worker start on Windows and complete a Job after both machines reboot,
without public API exposure or manual infrastructure commands.

## Acceptance criteria

- [ ] Checked-in example configuration covers the jump host, home reverse tunnel, notebook local tunnel, server, and worker without containing secrets or machine-specific values.
- [ ] SSH uses a dedicated account, key-only authentication, pinned host keys, loopback-only forwarding, keepalives, and immediate forward-failure detection.
- [ ] The home API is reachable from the notebook only through the authenticated local tunnel.
- [ ] The home router requires no inbound forwarding and the GCP VM exposes no meeting-processing HTTP port.
- [ ] The home server and reverse tunnel start at Windows boot and restart after transient failure.
- [ ] The notebook tunnel and workflow worker start at user login and restart after transient failure.
- [ ] Start, stop, status, install, and uninstall operations are documented and idempotent.
- [ ] Logs are rotated and redact credentials and Transcript content.
- [ ] Rebooting both machines and reconnecting the notebook eventually restores a ready authenticated path.
- [ ] A short Meeting recorded after reboot reaches a completed Job without manually starting a tunnel, server, worker, or Sync.

## Blocked by

- #35
