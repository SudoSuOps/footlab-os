# Local experimental MedGemma observations

The personal pilot saves capture images in `~/flo-private/vault/`, encrypted with the separate `~/flo-private/vault.key`. This runner reads a completed personal V2 receipt, verifies each image checksum, processes the six required views and optional extras sequentially, and writes a separate encrypted observation file under `~/flo-private/reviews/`. It does not update the capture registry, export plaintext images, send SMS, notify clinicians, or write to the NAS.

## Probe first

```bash
cd "$HOME/flo-pilot-app"
node scripts/review-private-checkin.mjs --probe
```

The probe reads no photos. It lists installed model names containing MedGemma with their Ollama digest, vision capability and remote metadata. Nothing is downloaded. A plain text MedGemma model cannot process the photos. A model name alone does not prove its origin or quality: verify its source/license and multimodal conversion before running. If no suitable model is installed, model provisioning is a separate step.

## Run a selected completed receipt

Replace the model placeholder with an exact installed vision model name returned by the probe:

```bash
node scripts/review-private-checkin.mjs --request 3cc3d0fa-8ff1-47f5-85d0-dcaf4880e6db --model YOUR_INSTALLED_MEDGEMMA_VISION_MODEL
```

The endpoint is fixed to `127.0.0.1:11434`; redirects and models advertising remote/cloud metadata are rejected. This relies on a trusted, locally managed Ollama daemon: the script cannot independently attest to its behavior. Do not configure that daemon to forward photo requests elsewhere. Hermes is not involved in photo processing.

Each call has a five-minute timeout, temperature zero and a 512-token output limit. One image is sent per call. Models are unloaded after each call to release VRAM (this can increase runtime). No automatic retries. Failed runs leave no saved partial review; prior successful reviews remain. Repeated successful runs create new files. Model text is untrusted and can ignore the prompt.

## Read the result locally

```bash
node scripts/review-private-checkin.mjs --request 3cc3d0fa-8ff1-47f5-85d0-dcaf4880e6db --show
```

This explicitly decrypts and prints the latest result in your terminal. It may contain health information; do not paste the full result into public logs. Outputs and filenames stay local. Capture credentials and raw capture links are not included in the report. Review files use the same vault key, so the existing same-user/key-management limitations apply. No automatic retention cleanup.

The runner is an experimental developer evaluation, not a clinically validated foot assessment, diagnosis, triage system or clearance. It asks for image quality, visible features and uncertainty. Neither prompt restrictions nor medical pretraining guarantees safe/accurate output. A photo cannot establish sensation, perfusion or absence of infection. Independent human review is required; no client-facing automated decisions are produced.

References: [Ollama vision API](https://docs.ollama.com/capabilities/vision), [Google MedGemma model card](https://developers.google.com/health-ai-developer-foundations/medgemma/model-card).
