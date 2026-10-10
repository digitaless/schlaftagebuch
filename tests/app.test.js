const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const appSource = fs.readFileSync(
  path.join(__dirname, "../schlaf-tagebuch/app.js"),
  "utf8"
);

class FakeElement {
  constructor(id = "") {
    this.id = id;
    this.value = "";
    this.textContent = "";
    this.innerHTML = "";
    this.disabled = false;
    this.style = {};
    this.dataset = {};
    this.listeners = new Map();
    this.classes = new Set();
    this.classList = {
      toggle: (name, enabled) => {
        if (enabled) this.classes.add(name);
        else this.classes.delete(name);
      },
    };
    this.files = [];
  }

  addEventListener(type, callback) {
    const callbacks = this.listeners.get(type) || [];
    callbacks.push(callback);
    this.listeners.set(type, callbacks);
  }

  async dispatch(type, extra = {}) {
    const event = { target: this, ...extra };
    await Promise.all((this.listeners.get(type) || []).map((callback) => callback(event)));
  }

  click() {
    this.clicked = true;
    return this.dispatch("click");
  }

  closest(selector) {
    return selector === "button[data-action]" && this.dataset.action ? this : null;
  }

  showModal() {
    this.open = true;
  }

  close() {
    this.open = false;
  }
}

class MemoryStorage {
  constructor(initial = {}) {
    this.values = new Map(Object.entries(initial));
    this.failSetFor = null;
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    if (key === this.failSetFor) throw new Error("Speicher voll");
    this.values.set(key, String(value));
  }

  removeItem(key) {
    this.values.delete(key);
  }
}

function makeEntry(date, overrides = {}) {
  return {
    date,
    windowStart: "23:00",
    windowEnd: "07:00",
    bed: "23:00",
    wake: "07:00",
    total: 480,
    effective: 450,
    awake: 30,
    nap: 0,
    quality: 4,
    notes: "",
    ...overrides,
  };
}

function createApp({
  entries = [],
  settings = { start: "23:00", end: "07:00" },
  rawEntries,
  failSetFor = null,
  confirm = true,
} = {}) {
  const storage = new MemoryStorage({
    "schlaftagebuch.entries.v1":
      rawEntries === undefined ? JSON.stringify(entries) : rawEntries,
    "schlaftagebuch.settings.v1": JSON.stringify(settings),
  });
  storage.failSetFor = failSetFor;

  const ids = [
    "savedNotice", "todayTitle", "date", "bed", "wake", "awake", "sleepCalc",
    "effectiveCalc", "nap", "napMin", "qualityText", "notes", "save",
    "historyList", "statCards", "chart", "defaultStart", "defaultEnd",
    "saveSettings", "export", "import", "clear", "importDialog", "importFile",
    "importJson", "importRawData", "restoreRaw", "cancelImport", "windowInfo",
  ];
  const elements = new Map(ids.map((id) => [id, new FakeElement(id)]));
  const stars = Array.from({ length: 5 }, (_, index) => {
    const element = new FakeElement(`star-${index + 1}`);
    element.dataset.value = String(index + 1);
    return element;
  });
  const tabs = ["today", "history", "stats", "settings"].map((view) => {
    const element = new FakeElement(`tab-${view}`);
    element.dataset.view = view;
    return element;
  });
  const views = ["today", "history", "stats", "settings"].map((id) => new FakeElement(id));
  const document = {
    getElementById: (id) => elements.get(id) || null,
    querySelectorAll: (selector) =>
      selector === ".star" ? stars : selector === ".tab" ? tabs : selector === ".view" ? views : [],
    createElement: (tag) => new FakeElement(tag),
  };
  const alerts = [];
  const context = vm.createContext({
    document,
    localStorage: storage,
    alert: (message) => alerts.push(message),
    confirm: () => confirm,
    setTimeout: () => 1,
    Blob: class {
      constructor(parts, options) {
        this.parts = parts;
        this.options = options;
      }
    },
    URL: {
      createObjectURL: () => "blob:test",
      revokeObjectURL: () => {},
    },
    Date,
    Math,
    Number,
    Set,
    JSON,
    String,
    Array,
    Error,
  });
  vm.runInContext(appSource, context, { filename: "app.js" });
  return { context, elements, alerts, storage, stars, tabs, views };
}

function fillEntryForm(app, date = "2026-10-09") {
  app.elements.get("date").value = date;
  app.elements.get("bed").value = "23:00";
  app.elements.get("wake").value = "07:00";
  app.elements.get("awake").value = "30";
  app.elements.get("nap").value = "0";
  app.elements.get("napMin").value = "0";
  app.elements.get("notes").value = "";
  vm.runInContext("selectedQuality = 4", app.context);
}

function storedEntries(app) {
  return JSON.parse(app.storage.getItem("schlaftagebuch.entries.v1"));
}

test("editing a date moves the entry and removes its former date", async () => {
  const app = createApp({ entries: [makeEntry("2026-10-08")] });
  vm.runInContext("loadEntryIntoForm(entries[0])", app.context);
  fillEntryForm(app, "2026-10-09");

  await app.elements.get("save").click();

  assert.deepEqual(storedEntries(app).map((entry) => entry.date), ["2026-10-09"]);
});

test("editing onto an occupied date preserves both entries", async () => {
  const initial = [makeEntry("2026-10-08"), makeEntry("2026-10-09", { quality: 3 })];
  const app = createApp({ entries: initial });
  vm.runInContext("loadEntryIntoForm(entries[0])", app.context);
  fillEntryForm(app, "2026-10-09");

  await app.elements.get("save").click();

  assert.deepEqual(storedEntries(app), initial);
  assert.match(app.alerts.at(-1), /bereits einen Eintrag/);
});

test("invalid dates and durations are rejected without saving", async () => {
  const app = createApp();
  fillEntryForm(app, "2026-02-30");
  await app.elements.get("save").click();
  assert.deepEqual(storedEntries(app), []);

  fillEntryForm(app);
  app.elements.get("awake").value = "485";
  await app.elements.get("save").click();
  assert.deepEqual(storedEntries(app), []);
});

test("malformed local JSON falls back safely and reports the problem", () => {
  const app = createApp({ rawEntries: "{" });
  assert.deepEqual(JSON.parse(vm.runInContext("JSON.stringify(entries)", app.context)), []);
  assert.equal(app.storage.getItem("schlaftagebuch.entries.v1"), "{");
  assert.match(app.alerts[0], /konnten nicht gelesen werden/);
});

test("storage write failures preserve in-memory and stored entries", async () => {
  const initial = [makeEntry("2026-10-08")];
  const app = createApp({ entries: initial, failSetFor: "schlaftagebuch.entries.v1" });
  fillEntryForm(app);

  await app.elements.get("save").click();

  assert.deepEqual(storedEntries(app), initial);
  assert.deepEqual(JSON.parse(vm.runInContext("JSON.stringify(entries)", app.context)), initial);
  assert.match(app.alerts.at(-1), /konnten nicht gespeichert werden/);
});

test("raw-data restoration is wired and replaces data after confirmation", async () => {
  const app = createApp({ entries: [makeEntry("2026-10-08")] });
  await app.elements.get("import").click();
  assert.equal(app.elements.get("importDialog").open, true);

  app.elements.get("importRawData").value = JSON.stringify({
    entries: [makeEntry("2026-10-09")],
    settings: { start: "22:30", end: "06:30" },
  });
  await app.elements.get("restoreRaw").click();

  assert.deepEqual(storedEntries(app).map((entry) => entry.date), ["2026-10-09"]);
  assert.equal(JSON.parse(app.storage.getItem("schlaftagebuch.settings.v1")).start, "22:30");
  assert.equal(app.elements.get("importDialog").open, false);
});

test("JSON file import works and invalid imported data is rejected", async () => {
  const app = createApp();
  await app.elements.get("importJson").click();
  assert.equal(app.elements.get("importFile").clicked, true);

  app.elements.get("importFile").files = [{
    text: async () => JSON.stringify({ entries: [makeEntry("2026-10-09")] }),
  }];
  await app.elements.get("importFile").dispatch("change");
  assert.deepEqual(storedEntries(app).map((entry) => entry.date), ["2026-10-09"]);

  app.elements.get("importRawData").value = JSON.stringify({ entries: [{ date: "invalid" }] });
  await app.elements.get("restoreRaw").click();
  assert.deepEqual(storedEntries(app).map((entry) => entry.date), ["2026-10-09"]);
  assert.match(app.alerts.at(-1), /ungültige oder unvollständige Daten/);
});

test("declining an import keeps the current diary unchanged", async () => {
  const initial = [makeEntry("2026-10-08")];
  const app = createApp({ entries: initial, confirm: false });
  app.elements.get("importRawData").value = JSON.stringify({
    entries: [makeEntry("2026-10-09")],
  });

  await app.elements.get("restoreRaw").click();

  assert.deepEqual(storedEntries(app), initial);
});

test("history edit and delete actions are wired", async () => {
  const app = createApp({ entries: [makeEntry("2026-10-08")] });
  const editButton = new FakeElement("edit");
  editButton.dataset.action = "edit";
  editButton.dataset.date = "2026-10-08";
  await app.elements.get("historyList").dispatch("click", { target: editButton });
  assert.equal(app.elements.get("date").value, "2026-10-08");
  assert.equal(app.elements.get("todayTitle").textContent, "Eintrag bearbeiten");

  const deleteButton = new FakeElement("delete");
  deleteButton.dataset.action = "delete";
  deleteButton.dataset.date = "2026-10-08";
  await app.elements.get("historyList").dispatch("click", { target: deleteButton });
  assert.deepEqual(storedEntries(app), []);
});

test("settings, export, clear and navigation controls have working handlers", async () => {
  const app = createApp({ entries: [makeEntry("2026-10-08")] });
  app.elements.get("defaultStart").value = "22:00";
  app.elements.get("defaultEnd").value = "06:00";
  await app.elements.get("saveSettings").click();
  assert.equal(JSON.parse(app.storage.getItem("schlaftagebuch.settings.v1")).start, "22:00");

  await app.elements.get("export").click();
  assert.equal(app.elements.get("export").clicked, true);
  await app.elements.get("cancelImport").click();
  assert.equal(app.elements.get("importDialog").open, false);
  await app.tabs.find((tab) => tab.dataset.view === "history").click();
  assert.equal(app.views.find((view) => view.id === "history").classes.has("active"), true);

  await app.elements.get("clear").click();
  assert.equal(app.storage.getItem("schlaftagebuch.entries.v1"), null);
});
