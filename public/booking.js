"use strict";
const form = document.getElementById("booking-form");
const dateInput = form.elements.date,
  serviceInput = form.elements.service,
  slots = form.elements.starts_at;
const slotStatus = document.getElementById("slot-status");
const parts = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).formatToParts(new Date());
const part = (k) => parts.find((p) => p.type === k).value;
dateInput.min = `${part("year")}-${part("month")}-${part("day")}`;
let generation = 0;
async function loadSlots() {
  const current = ++generation;
  slots.replaceChildren(new Option("Choose a time", ""));
  slots.disabled = true;
  if (!dateInput.value) {
    slotStatus.textContent = "Choose a date to see availability.";
    return;
  }
  slotStatus.textContent = "Loading times…";
  try {
    const res = await fetch(
      `/api/availability?${new URLSearchParams({ date: dateInput.value, service: serviceInput.value })}`,
    );
    const data = await res.json();
    if (current !== generation) return;
    if (!res.ok) throw new Error(data.message);
    for (const slot of data.data)
      slots.add(new Option(slot.label, slot.starts_at));
    slots.disabled = !data.data.length;
    slotStatus.textContent = data.data.length
      ? "All times are in New York / Eastern time."
      : "No times available. Choose another date or contact Yihan.";
  } catch {
    if (current === generation)
      slotStatus.textContent =
        "Unable to load times. Please try again or contact Yihan.";
  }
}
dateInput.addEventListener("change", loadSlots);
serviceInput.addEventListener("change", loadSlots);
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const button = document.getElementById("submit-btn"),
    success = document.getElementById("booking-success"),
    error = document.getElementById("booking-error");
  success.style.display = error.style.display = "none";
  if (!slots.value || slots.disabled) {
    error.textContent = "Choose an available date and time.";
    error.style.display = "block";
    return;
  }
  button.disabled = true;
  button.textContent = "Sending…";
  try {
    const payload = Object.fromEntries(new FormData(form));
    const res = await fetch("/api/appointments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message);
    form.reset();
    await loadSlots();
    success.style.display = "block";
    success.scrollIntoView({ behavior: "smooth", block: "center" });
  } catch (err) {
    error.textContent =
      err.message || "Unable to submit. Please contact Yihan.";
    error.style.display = "block";
  } finally {
    button.disabled = false;
    button.textContent = "SEND W/ LOVE";
  }
});
