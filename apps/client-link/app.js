const app = document.querySelector("#app");
const token = location.pathname.split("/").filter(Boolean).at(-1);

const views = [
  ["right-plantar", "Right foot · bottom", "Photograph the full bottom of the right foot."],
  ["left-plantar", "Left foot · bottom", "Photograph the full bottom of the left foot."],
  ["right-targeted", "Right foot · targeted", "Photograph the area your FootLab plan asks us to monitor."],
  ["left-targeted", "Left foot · targeted", "Photograph the area your FootLab plan asks us to monitor."],
];

const state = { files: new Map(), previews: new Map(), submitting: false };

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers ?? {}) },
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error ?? "Request failed");
  return payload;
}

function showError(message) {
  app.innerHTML = `<h1>We couldn't open this check-in.</h1><div class="status danger">${escapeHtml(message)}</div><p>Please use the most recent FLO message or contact the FootLab team.</p>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
}

async function load() {
  try {
    const info = await api(`/api/capture/${encodeURIComponent(token)}`);
    if (info.state !== "valid") return showError(`This check-in is ${info.state}.`);
    renderWelcome(info);
  } catch (error) {
    showError(error.message);
  }
}

function renderWelcome(info) {
  app.innerHTML = `
    <h1>Your FLO check-in is ready.</h1>
    <p>You'll take four guided photos and answer two short questions. Most check-ins take only a few minutes.</p>
    <div class="meta"><span class="pill">Demo session</span><span class="pill">4 photos</span><span class="pill">No password</span></div>
    <button id="start" class="button primary">Start Check-In</button>
    <div class="status">Prototype demo: photo bytes stay on this device. Only photo details and your answers are submitted. Use synthetic photos and notes.</div>
  `;
  document.querySelector("#start").addEventListener("click", start);
}

async function start() {
  try {
    await api(`/api/capture/${encodeURIComponent(token)}/start`, { method:"POST", body:"{}" });
    renderCapture();
  } catch (error) {
    showError(error.message);
  }
}

function renderCapture() {
  app.innerHTML = `
    <div class="step"><h1>Foot photos</h1><p>Good lighting, the whole foot in frame, and no filters. Retake any image that is blurry.</p></div>
    <p id="progress" role="status">0 of 4 photos ready</p><div id="views"></div>
    <div class="checkin">
      <label>Since your last check-in, have you noticed a meaningful change?
        <select id="change"><option value="">Choose one</option><option value="no">No</option><option value="yes">Yes</option><option value="unsure">Not sure</option></select>
      </label>
      <label>Anything you want the FootLab team to know?
        <textarea id="note" rows="3" maxlength="500" placeholder="Optional"></textarea>
      </label>
    </div>
    <div id="feedback" role="alert" class="status danger" hidden></div><button id="submit" class="button primary">Submit Check-In</button>
  `;

  const container = document.querySelector("#views");
  for (const [id, title, hint] of views) {
    const box = document.createElement("div");
    box.className = "view";
    box.innerHTML = `
      <div class="view-head"><div><strong>${title}</strong><br><small>${hint}</small></div><span id="state-${id}" class="pill">Required</span></div>
      <input id="${id}" aria-label="${title}" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" capture="environment" />
      <img id="preview-${id}" class="preview" hidden alt="" />
    `;
    container.appendChild(box);

    box.querySelector("input").addEventListener("change", event => {
      const file = event.target.files?.[0];
      if (!file) return;
      if (!["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"].includes(file.type) || file.size <= 0 || file.size > 20 * 1024 * 1024) {
        feedback("Choose a JPEG, PNG, WebP or HEIF photo under 20 MB.");
        event.target.value = "";
        return;
      }
      if (state.previews.has(id)) URL.revokeObjectURL(state.previews.get(id));
      state.files.set(id, file);
      const preview = box.querySelector("img");
      const url = URL.createObjectURL(file);
      state.previews.set(id, url);
      preview.src = url;
      preview.alt = title + " selected preview";
      document.querySelector("#progress").textContent = `${state.files.size} of 4 photos ready`;
      document.querySelector("#feedback").hidden = true;
      preview.hidden = false;
      box.querySelector(`#state-${id}`).textContent = "Ready";
    });
  }

  document.querySelector("#submit").addEventListener("click", submit);
}

function feedback(message) {
  const box = document.querySelector("#feedback");
  box.textContent = message;
  box.hidden = false;
}

async function submit() {
  if (state.submitting) return;
  if (state.files.size !== views.length) {
    return feedback("Please add all four required photos.");
  }

  const change = document.querySelector("#change").value;
  if (!change) return feedback("Please answer the change question.");

  const captures = [...state.files.entries()].map(([viewId, file]) => ({
    viewId,
    mimeType: file.type,
    size: file.size,
  }));

  state.submitting = true;
  const button = document.querySelector("#submit");
  button.disabled = true;
  button.textContent = "Submitting…";
  try {
    await api(`/api/capture/${encodeURIComponent(token)}/complete`, {
      method:"POST",
      body: JSON.stringify({
        captures,
        checkIn: {
          meaningfulChange: change,
          note: document.querySelector("#note").value.trim(),
        },
      }),
    });

    for (const url of state.previews.values()) URL.revokeObjectURL(url);
    state.previews.clear();
    state.files.clear();
    app.innerHTML = `
      <h1>Check-in complete.</h1>
      <div class="status">Your demo check-in details were received. Photo bytes were not uploaded.</div>
      <p>This prototype does not place photos in a clinical review queue. If you have urgent concerns, contact the appropriate member of your care team rather than waiting for this system.</p>
    `;
  } catch (error) {
    feedback(error.message + " Your selections are still here. You can retry.");
    button.disabled = false;
    button.textContent = "Retry submission";
  } finally {
    state.submitting = false;
  }
}

load();
