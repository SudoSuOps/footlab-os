const app = document.querySelector("#app");
const token = location.pathname.split("/").filter(Boolean).at(-1);

const views = [
  ["left-plantar", "Left foot · bottom", "Photograph the full bottom of the left foot."],
  ["left-dorsal", "Left foot · top", "Photograph the full top of the left foot."],
  ["right-plantar", "Right foot · bottom", "Photograph the full bottom of the right foot."],
  ["right-dorsal", "Right foot · top", "Photograph the full top of the right foot."],
];

const state = { files: new Map() };

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
  app.innerHTML = `<h1>We couldn't open this check-in.</h1><div class="status danger">${escapeHtml(message)}</div><p>Please use the most recent OpenFootLab message or contact the FootLab team.</p>`;
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
    <h1>Your secure foot check-in is ready.</h1>
    <p>You'll take four guided photos and answer two short questions. Most check-ins take only a few minutes.</p>
    <div class="meta"><span class="pill">Secure session</span><span class="pill">4 photos</span><span class="pill">No password</span></div>
    <button id="start" class="button primary">Start Check-In</button>
    <p><small>Opening this page does not consume your link. The secure session starts only when you tap the button above.</small></p>
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
    <div id="views"></div>
    <div class="checkin">
      <label>Since your last check-in, have you noticed a meaningful change?
        <select id="change"><option value="">Choose one</option><option value="no">No</option><option value="yes">Yes</option><option value="unsure">Not sure</option></select>
      </label>
      <label>Anything you want the FootLab team to know?
        <textarea id="note" rows="3" maxlength="500" placeholder="Optional"></textarea>
      </label>
    </div>
    <button id="submit" class="button primary">Submit Check-In</button>
  `;

  const container = document.querySelector("#views");
  for (const [id, title, hint] of views) {
    const box = document.createElement("div");
    box.className = "view";
    box.innerHTML = `
      <div class="view-head"><div><strong>${title}</strong><br><small>${hint}</small></div><span id="state-${id}" class="pill">Required</span></div>
      <input id="${id}" type="file" accept="image/*" capture="environment" />
      <img id="preview-${id}" class="preview" hidden alt="" />
    `;
    container.appendChild(box);

    box.querySelector("input").addEventListener("change", event => {
      const file = event.target.files?.[0];
      if (!file) return;
      state.files.set(id, file);
      const preview = box.querySelector("img");
      preview.src = URL.createObjectURL(file);
      preview.hidden = false;
      box.querySelector(`#state-${id}`).textContent = "Ready";
    });
  }

  document.querySelector("#submit").addEventListener("click", submit);
}

async function submit() {
  if (state.files.size !== views.length) {
    return alert("Please add all four required photos.");
  }

  const change = document.querySelector("#change").value;
  if (!change) return alert("Please answer the change question.");

  const captures = [...state.files.entries()].map(([viewId, file]) => ({
    viewId,
    fileName: file.name,
    mimeType: file.type,
    size: file.size,
  }));

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

    app.innerHTML = `
      <h1>Check-in complete.</h1>
      <div class="status">Your FootLabOS check-in was submitted successfully.</div>
      <p>The FootLab team can now continue the review workflow. If you have urgent concerns, contact the appropriate member of your care team rather than waiting for this system.</p>
    `;
  } catch (error) {
    showError(error.message);
  }
}

load();
