import {
  CAPTURE_STEPS,
  EXTRA_SLOTS,
  PROTOCOL_ID,
  MAX_IMAGE_BYTES,
} from "/client/protocol.mjs";
const app = document.querySelector("#app"),
  token = location.pathname.split("/").filter(Boolean).at(-1),
  endpoint = "/api/capture/" + encodeURIComponent(token);
const state = {
  page: "welcome",
  step: 0,
  photos: new Map(),
  busy: false,
  change: "",
  note: "",
  error: "",
  info: null,
};
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const camera =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M3 7h4l2-3h6l2 3h4v13H3z"/><circle cx="12" cy="13" r="4"/></svg>';
function footArt(foot = "Right", view = "Top") {
  return `<svg class="illustration" viewBox="0 0 130 190" fill="none" aria-hidden="true"><g ${foot === "Left" ? 'transform="translate(130 0) scale(-1 1)"' : ""}><path d="M44 170c-12-2-18-13-18-25 0-22 6-32 6-53 0-18-8-29-3-50 3-12 9-14 14-10 3-17 16-23 23-10 8-13 18-12 22 1 9-6 17 1 17 11 10 0 13 10 10 18-4 11-11 19-18 27-11 13-14 29-13 48 1 24-7 43-23 45z" fill="#dff0ce" stroke="#87aa6b" stroke-width="2"/><path d="M41 89c16 6 27 4 42-3M40 129c15 7 23 6 36 0" stroke="#b9d69e" stroke-width="2"/><circle cx="61" cy="${view === "Bottom" ? 143 : 76}" r="21" fill="#5b8c33" fill-opacity=".08" stroke="#77a94b" stroke-dasharray="3 4"/><path d="M53 76h16M61 68v16" stroke="#5b8c33" stroke-width="2"/></g></svg>`;
}
async function api(path, options = {}) {
  const response = await fetch(endpoint + path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-FLO-Request": "1",
      ...options.headers,
    },
  });
  const payload = await response.json();
  if (!response.ok)
    throw new Error(payload.error ?? "Connection interrupted. Please retry.");
  return payload;
}
function rail() {
  const phase =
    state.page === "welcome"
      ? 0
      : state.page === "capture"
        ? state.step < 3
          ? 0
          : 1
        : state.page === "extras"
          ? 2
          : 3;
  return `<aside class="rail"><div class="eyebrow">Your daily ritual</div><h2>A moment for<br>your feet.</h2><p>One photo at a time.<br>We’ll guide you through.</p><ol class="journey">${["Right", "Left", "Extras", "Review"].map((label, i) => `<li class="${i === phase ? "active" : i < phase ? "done" : ""}"><span class="number">${i < phase ? "✓" : i + 1}</span>${label}</li>`).join("")}</ol><div class="rail-note">${state.info?.privatePilot ? "A daily record, saved on your rig." : "Your check-in is a conversation with your care team."}<br><strong>You’re part of the crew.</strong></div></aside>`;
}
function frame(content) {
  app.setAttribute("aria-busy", String(state.busy));
  app.innerHTML = `<div class="experience">${rail()}<section class="stage">${content}<div id="error" class="error" role="alert" ${state.error ? "" : "hidden"}>${escape(state.error)}</div></section></div>`;
}
function showError(message) {
  state.error = message;
  const box = document.querySelector("#error");
  if (box) {
    box.textContent = message;
    box.hidden = false;
  } else render();
}
function clearError() {
  state.error = "";
  const box = document.querySelector("#error");
  if (box) box.hidden = true;
}
function navigate(page, step = state.step) {
  if (state.busy) return;
  state.page = page;
  state.step = step;
  clearError();
  render();
  document.querySelector("h1")?.focus();
}
function render() {
  if (state.page === "capture") return renderCapture();
  if (state.page === "extras") return renderExtras();
  if (state.page === "review") return renderReview();
  if (state.page === "complete") return renderComplete();
  if (state.page === "unavailable") {
    frame(
      `<div class="eyebrow">Let’s reconnect</div><h1>This link isn’t<br>ready to use.</h1><p class="intro">${escape(state.error)}</p><p class="note">Use your latest FLO text or contact the FootLab team for a new link.</p>`,
    );
    return;
  }
  frame(
    `<div class="eyebrow">FootLab · Personal check-in</div><h1>It’s <em>FLO time.</em></h1><p class="intro">A little check-in. A little peace of mind.<br>Let’s take a look at your feet together.</p><div class="welcome-art"><p>Right foot. Left foot.<br>You’ve got this.<small>TOP → SIDES → BOTTOM</small></p>${footArt()}</div><div class="chips"><span class="chip">6 guided photos</span><span class="chip">Up to 4 extras</span><span class="chip">No app. No password.</span></div><button id="start" class="primary">${state.busy ? "Getting ready…" : state.photos.size ? "Continue my check-in →" : "Let’s check in →"}</button><p class="note">Sit comfortably. Keep your foot supported.<br>Ask someone to help with angles that are hard to reach.</p>`,
  );
  document.querySelector("#start").disabled = state.busy;
  document.querySelector("#start").onclick = async () => {
    if (state.busy) return;
    state.busy = true;
    render();
    try {
      await api("/start", { method: "POST", body: "{}" });
      state.busy = false;
      const next = CAPTURE_STEPS.findIndex((s) => !state.photos.has(s.id));
      navigate(next === -1 ? "extras" : "capture", Math.max(0, next));
    } catch (error) {
      state.busy = false;
      render();
      showError(error.message);
    }
  };
}
function bindFile(inputId, slot) {
  document.getElementById(inputId).onchange = (event) => {
    const file = event.target.files?.[0];
    if (file) selectPhoto(slot, file);
  };
}
function upload(slot, blob, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", endpoint + "/photos/" + slot);
    xhr.timeout = 120000;
    xhr.setRequestHeader("Content-Type", blob.type);
    xhr.setRequestHeader("X-FLO-Request", "1");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable)
        onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      let data;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        return reject(new Error("Could not confirm upload. Please retry."));
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data.photo);
      else reject(new Error(data.error ?? "Upload failed."));
    };
    xhr.onerror = () =>
      reject(
        new Error(
          "Connection interrupted. Your photo is still here. Retry when ready.",
        ),
      );
    xhr.ontimeout = () =>
      reject(
        new Error("Upload timed out. Your photo is still here. Please retry."),
      );
    xhr.send(blob);
  });
}
async function normalizePhoto(file) {
  if (file.size <= 0 || file.size > MAX_IMAGE_BYTES)
    throw new Error("Choose a photo under 20 MB.");
  if (
    ![
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/heic",
      "image/heif",
    ].includes(file.type)
  )
    throw new Error("Choose a photo file, such as JPEG or PNG.");
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight)
      throw new Error("Empty image");
    // Normalize EXIF orientation and remove metadata before upload; preserve pixel dimensions.
    if (image.naturalWidth * image.naturalHeight > 24000000)
      throw new Error("Photo too large to prepare");
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    canvas.getContext("2d").drawImage(image, 0, 0);
    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.94),
    );
    canvas.width = canvas.height = 0;
    if (!blob || blob.size > MAX_IMAGE_BYTES)
      throw new Error("Photo too large to prepare");
    return blob;
  } catch {
    throw new Error(
      "This photo could not be prepared. Try the camera or choose a JPEG/PNG version.",
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}
async function selectPhoto(slot, file) {
  if (state.busy) return;
  clearError();
  state.busy = true;
  const existing = state.photos.get(slot);
  try {
    const blob = await normalizePhoto(file);
    if (existing?.url?.startsWith("blob:")) URL.revokeObjectURL(existing.url);
    state.photos.set(slot, {
      blob,
      url: URL.createObjectURL(blob),
      status: "uploading",
      progress: 0,
    });
    render();
    await sendPhoto(slot);
  } catch (error) {
    showError(error.message);
  } finally {
    state.busy = false;
    render();
  }
}
async function sendPhoto(slot) {
  const photo = state.photos.get(slot);
  photo.status = "uploading";
  try {
    photo.meta = await upload(slot, photo.blob, (progress) => {
      photo.progress = progress;
      const label = document.getElementById("upload-" + slot);
      if (label) label.textContent = `Uploading ${progress}%…`;
    });
    photo.status = "ready";
  } catch (error) {
    photo.status = "failed";
    throw error;
  }
}
function fileControl(id, label) {
  return `<input class="file-input" id="${id}" type="file" accept="image/*" capture="environment"><label class="camera-label" for="${id}">${camera}${label}</label>`;
}
function photoStatus(slot) {
  const photo = state.photos.get(slot);
  return `<p id="upload-${slot}" class="upload-state ${photo?.status === "ready" ? "ready" : ""}" role="status">${photo?.status === "ready" ? "✓ Photo received" : photo?.status === "failed" ? "Upload interrupted · retry below" : photo?.status === "uploading" ? `Uploading ${photo.progress}%…` : "Ready when you are"}</p>`;
}
function renderCapture() {
  const step = CAPTURE_STEPS[state.step],
    photo = state.photos.get(step.id),
    ready = photo?.status === "ready";
  frame(
    `<div class="step-meta"><span>PHOTO ${state.step + 1} OF 6</span><span>${step.foot.toUpperCase()} FOOT</span></div><div class="progress"><span style="width:${(state.step / 6) * 100}%"></span></div><h1 tabindex="-1">${step.foot} foot.<br><em>${step.view} view.</em></h1><p class="intro">${step.hint}</p><div class="photo-zone">${photo ? `<img src="${escape(photo.url)}" alt="${step.foot} foot ${step.view} selected photo">` : footArt(step.foot, step.view)}<span class="zone-label">${step.foot.toUpperCase()} · ${step.view.toUpperCase()}</span></div>${photoStatus(step.id)}<div class="actions">${fileControl("camera", photo ? "Retake photo" : "Take a photo")}<button id="next" class="primary" ${!ready || state.busy ? "disabled" : ""}>${state.step === 5 ? "Add optional photos →" : "Looks good. Next →"}</button>${photo?.status === "failed" ? '<button id="retry" class="secondary">Retry upload</button>' : ""}<button id="back" class="text-button">${state.step ? "← Previous photo" : "← Back to welcome"}</button></div>`,
  );
  bindFile("camera", step.id);
  document.querySelector("#camera").disabled = state.busy;
  document.querySelector("#next").onclick = () =>
    navigate(
      state.step === 5 ? "extras" : "capture",
      Math.min(5, state.step + 1),
    );
  document.querySelector("#back").onclick = () =>
    navigate(state.step ? "capture" : "welcome", Math.max(0, state.step - 1));
  if (document.querySelector("#retry"))
    document.querySelector("#retry").onclick = () => retryPhoto(step.id);
}
async function retryPhoto(slot) {
  if (state.busy) return;
  state.busy = true;
  clearError();
  render();
  try {
    await sendPhoto(slot);
  } catch (error) {
    showError(error.message);
  } finally {
    state.busy = false;
    render();
  }
}
async function removePhoto(slot) {
  if (state.busy) return;
  state.busy = true;
  clearError();
  render();
  try {
    await api("/photos/" + slot, { method: "DELETE" });
    const p = state.photos.get(slot);
    if (p?.url.startsWith("blob:")) URL.revokeObjectURL(p.url);
    state.photos.delete(slot);
  } catch (error) {
    showError(error.message);
  } finally {
    state.busy = false;
    render();
  }
}
function renderExtras() {
  const count = EXTRA_SLOTS.filter((s) => state.photos.has(s)).length;
  frame(
    `<div class="eyebrow">A little more detail · Optional</div><h1 tabindex="-1">Anything else<br>to <em>show us?</em></h1><p class="intro">Add up to four extra photos: the other side, a closer look, or an area your care team asked to see.</p><div class="extras-grid">${EXTRA_SLOTS.map(
      (slot, i) => {
        const p = state.photos.get(slot);
        return `<div class="extra">${p ? `<img src="${escape(p.url)}" alt="Extra photo ${i + 1}">` : '<div class="placeholder" aria-hidden="true">＋</div>'}${fileControl("file-" + slot, p ? "Replace photo" : `Extra photo ${i + 1}`)}${photoStatus(slot)}${p ? `<button class="text-button remove" data-slot="${slot}">Remove</button>` : ""}${p?.status === "failed" ? `<button class="text-button retry" data-slot="${slot}">Retry upload</button>` : ""}</div>`;
      },
    ).join(
      "",
    )}</div><div class="actions"><button id="review" class="primary" ${state.busy || [...state.photos.values()].some((p) => p.status !== "ready") ? "disabled" : ""}>${count ? "Review my check-in →" : "Skip extras. Review →"}</button><button id="back" class="text-button">← Back to left foot</button></div>`,
  );
  EXTRA_SLOTS.forEach((slot) => {
    bindFile("file-" + slot, slot);
    document.getElementById("file-" + slot).disabled = state.busy;
  });
  document.querySelectorAll(".remove").forEach((b) => {
    b.disabled = state.busy;
    b.onclick = () => removePhoto(b.dataset.slot);
  });
  document
    .querySelectorAll(".retry")
    .forEach((b) => (b.onclick = () => retryPhoto(b.dataset.slot)));
  document.querySelector("#review").onclick = () => navigate("review");
  document.querySelector("#back").onclick = () => navigate("capture", 5);
}
function renderReview() {
  const photos = [
    ...CAPTURE_STEPS.map((s) => ({ id: s.id, label: `${s.foot} · ${s.view}` })),
    ...EXTRA_SLOTS.filter((s) => state.photos.has(s)).map((id, i) => ({
      id,
      label: `Extra photo ${i + 1}`,
    })),
  ];
  frame(
    `<div class="eyebrow">One last look</div><h1 tabindex="-1">Your check-in.<br><em>Ready to send.</em></h1><p class="intro">Check your photos, then tell us how things have been.</p><div class="review-grid">${photos.map((p) => `<div class="review-tile"><img src="${escape(state.photos.get(p.id)?.url ?? "")}" alt="${escape(p.label)}"><button class="edit-photo" data-slot="${p.id}">${escape(p.label)} <span aria-hidden="true">↗</span><span class="sr-only"> Edit photo</span></button></div>`).join("")}</div><div class="form-row"><label for="change">Have you noticed a change since your last check-in?</label><select id="change"><option value="">Choose one</option><option value="no">No change noticed</option><option value="yes">Yes, I noticed a change</option><option value="unsure">I’m not sure</option></select></div><div class="form-row"><label for="note">Anything you want to share? <span class="optional">(optional)</span></label><textarea id="note" rows="3" maxlength="500" placeholder="In your own words…">${escape(state.note)}</textarea></div><button id="submit" class="primary" ${state.busy ? "disabled" : ""}>${state.busy ? "Sending your check-in…" : `Send my ${state.photos.size} photos →`}</button><p class="note">${state.info?.privatePilot ? "Your photos stay in your private FLO vault. This pilot does not notify a care team." : "Your photos go to this local prototype vault. This test does not notify a care team."}</p><button id="back" class="text-button">← Back to extra photos</button>`,
  );
  document.querySelector("#change").value = state.change;
  document.querySelector("#change").onchange = (e) =>
    (state.change = e.target.value);
  document.querySelector("#note").oninput = (e) =>
    (state.note = e.target.value);
  document.querySelectorAll(".edit-photo").forEach(
    (b) =>
      (b.onclick = () => {
        const index = CAPTURE_STEPS.findIndex((s) => s.id === b.dataset.slot);
        navigate(
          index < 0 ? "extras" : "capture",
          index < 0 ? state.step : index,
        );
      }),
  );
  document.querySelector("#back").onclick = () => navigate("extras");
  document.querySelector("#submit").onclick = submit;
}
async function submit() {
  if (state.busy) return;
  if (!state.change)
    return showError("Please answer the change question before sending.");
  state.busy = true;
  clearError();
  render();
  try {
    const data = await api("/complete", {
      method: "POST",
      body: JSON.stringify({
        protocolId: PROTOCOL_ID,
        slots: [...state.photos.keys()],
        checkIn: { meaningfulChange: state.change, note: state.note },
      }),
    });
    state.receipt = data.receipt;
    state.page = "complete";
    for (const p of state.photos.values())
      if (p.url.startsWith("blob:")) URL.revokeObjectURL(p.url);
    state.photos.clear();
  } catch (error) {
    showError(
      error.message + " Your photos and answers are kept here for retry.",
    );
  } finally {
    state.busy = false;
    render();
  }
}
function renderComplete() {
  const r = state.receipt;
  frame(
    `<div class="receipt-icon" aria-hidden="true">✓</div><div class="eyebrow">Check-in received</div><h1 tabindex="-1">You showed up.<br><em>That matters.</em></h1><p class="intro">Your ${r.photoCount} photos and answers have been saved to ${state.info?.privatePilot ? "your private FLO vault" : "the local FLO prototype"}.</p><div class="receipt"><strong>Upload complete</strong><br>${r.photoCount} photos · ${escape(new Date(r.receivedAt).toLocaleString())}<br>Receipt ${escape(r.requestId.slice(0, 8).toUpperCase())}</div><p class="note">You can close this page. This test receipt confirms storage, not clinical review or clearance.</p>`,
  );
}
async function load() {
  try {
    state.info = await api("");
    document.querySelector(".prototype").textContent = state.info.privatePilot ? "PRIVATE PERSONAL PILOT · Storage receipt only" : "LOCAL PROTOTYPE · Use test photos";
    if (state.info.protocolId !== PROTOCOL_ID)
      throw new Error(
        "This link uses an earlier photo plan. Ask for a new FLO link.",
      );
    if (state.info.state === "completed" && state.info.receipt) {
      state.receipt = state.info.receipt;
      state.page = "complete";
    } else if (state.info.state !== "valid") {
      state.page = "unavailable";
      state.error = `This check-in is ${state.info.state}.`;
    } else
      for (const [slot, meta] of Object.entries(state.info.uploads)) {
        state.photos.set(slot, {
          meta,
          status: "ready",
          url: endpoint + "/photos/" + slot,
        });
      }
    render();
  } catch (error) {
    state.page = "unavailable";
    state.error = error.message;
    render();
  } finally {
    app.setAttribute("aria-busy", "false");
  }
}
window.addEventListener("beforeunload", (e) => {
  if (state.busy) {
    e.preventDefault();
    e.returnValue = "";
  }
});
load();
