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
      add: (name) => this.classes.add(name),
      remove: (name) => this.classes.delete(name),
      contains: (name) => this.classes.has(name),
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

  removeEventListener(type, callback) {
    const callbacks = this.listeners.get(type) || [];
    this.listeners.set(type, callbacks.filter((listener) => listener !== callback));
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
    this.dispatch("close");
  }

  querySelectorAll(selector) {
    return selector === ".count-sheep" ? this.sheepNodes || [] : [];
  }

  focus() {
    this.focused = true;
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
    "effectiveCalc", "nap", "napMin", "medication", "medicationNameField",
    "medicationName", "countSheep", "sheepDialog", "closeSheep", "restartSheep",
    "sheepTrack", "sheepCounter", "sheepFinale", "qualityText", "notes", "save",
    "historyList", "statCards", "chart", "defaultStart", "defaultEnd",
    "saveSettings", "export", "exportPdf", "import", "clear", "importDialog", "importFile",
    "importJson", "importRawData", "restoreRaw", "cancelImport", "windowInfo", "printReport",
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
  const documentListeners = new Map();
  const document = {
    activeElement: null,
    listeners: documentListeners,
    addEventListener: (type, callback) => {
      const callbacks = documentListeners.get(type) || [];
      callbacks.push(callback);
      documentListeners.set(type, callbacks);
    },
    removeEventListener: (type, callback) => {
      const callbacks = documentListeners.get(type) || [];
      documentListeners.set(type, callbacks.filter((listener) => listener !== callback));
    },
    dispatch: async (type, event = {}) => {
      await Promise.all((documentListeners.get(type) || []).map((callback) =>
        callback({ ...event, preventDefault: () => { event.defaultPrevented = true; } })
      ));
    },
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
    window: { print: () => {}, matchMedia: () => ({ matches: false }) },
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
  app.elements.get("medication").value = "0";
  app.elements.get("medicationName").value = "";
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

test("medication details are saved and carried forward when selected the next day", async () => {
  const app = createApp();
  fillEntryForm(app, "2026-10-08");
  app.elements.get("medication").value = "1";
  await app.elements.get("medication").dispatch("change");
  assert.equal(app.elements.get("medicationNameField").hidden, false);
  app.elements.get("medicationName").value = "Melatonin";
  await app.elements.get("save").click();

  assert.equal(storedEntries(app)[0].medication, true);
  assert.equal(storedEntries(app)[0].medicationName, "Melatonin");
  assert.equal(app.elements.get("historyList").innerHTML.includes("Melatonin"), true);

  fillEntryForm(app, "2026-10-09");
  app.elements.get("medication").value = "1";
  await app.elements.get("medication").dispatch("change");
  assert.equal(app.elements.get("medicationName").value, "Melatonin");
  await app.elements.get("save").click();

  assert.deepEqual(
    storedEntries(app).map(({ date, medication, medicationName }) => ({
      date,
      medication,
      medicationName,
    })),
    [
      { date: "2026-10-09", medication: true, medicationName: "Melatonin" },
      { date: "2026-10-08", medication: true, medicationName: "Melatonin" },
    ]
  );
});

test("legacy entries without medication fields remain valid", () => {
  const app = createApp({ entries: [makeEntry("2026-10-08")] });
  assert.deepEqual(
    JSON.parse(vm.runInContext("JSON.stringify(validateEntry(entries[0]))", app.context)).medication,
    false
  );
});

test("sheep counter opens, counts ten sheep, restarts and cleans up on close", async () => {
  const app = createApp();
  const sheepButton = app.elements.get("countSheep");
  const dialog = app.elements.get("sheepDialog");
  const track = app.elements.get("sheepTrack");
  track.sheepNodes = Array.from({ length: 10 }, (_, index) => {
    const sheep = new FakeElement(`sheep-${index}`);
    sheep.dataset.sheepIndex = String(index);
    return sheep;
  });
  app.context.document.activeElement = sheepButton;

  await sheepButton.click();
  assert.equal(dialog.open, true);
  assert.match(track.innerHTML, /data-sheep-index="9"/);
  assert.equal(app.elements.get("sheepCounter").textContent, "Schafe gezählt: 0");

  const messages = [
    "Und, schon müde?",
    "Jetzt aber ab ins Bettchen!",
    "Die Schäfchen sind schon müder als du.",
    "Na los, Augen zu und gute Nacht!",
    "Noch wach? Das kann doch nicht wahr sein.",
    "Dein Kopfkissen vermisst dich.",
    "Schnarch … äh, das warst nicht du, oder?",
    "Selbst die Schäfchen fallen gleich um.",
    "Morgen ist auch noch ein Tag. Hoffentlich.",
    "Gute Nacht! Wir zählen dann mal ohne dich weiter.",
    "Du hast gewonnen. Die Müdigkeit gibt auf. Gute Nacht!",
  ];

  for (let count = 1; count <= 120; count += 1) {
    await track.dispatch("animationend", {
      target: track.sheepNodes[(count - 1) % track.sheepNodes.length],
    });
    if (count % 10 === 0) {
      assert.equal(app.elements.get("sheepCounter").textContent, `Schafe gezählt: ${count}`);
      assert.equal(
        app.elements.get("sheepFinale").textContent,
        messages[Math.min(count / 10 - 1, messages.length - 1)]
      );
    }
  }

  assert.equal(app.elements.get("sheepCounter").textContent, "Schafe gezählt: 120");
  assert.equal(app.elements.get("sheepFinale").hidden, false);
  assert.match(track.innerHTML, /data-sheep-index="9"/);
  assert.equal(app.elements.get("sheepFinale").textContent, messages.at(-1));

  await app.elements.get("restartSheep").click();
  assert.equal(app.elements.get("sheepCounter").textContent, "Schafe gezählt: 0");
  assert.equal(app.elements.get("sheepFinale").hidden, true);
  assert.ok(track.listeners.get("animationend").length);

  await app.elements.get("closeSheep").click();
  assert.equal(dialog.open, false);
  assert.equal(track.innerHTML, "");
  assert.deepEqual(track.listeners.get("animationend"), []);
  assert.equal(sheepButton.focused, true);

  await sheepButton.click();
  await dialog.dispatch("click", { target: dialog });
  assert.equal(dialog.open, false);

  await sheepButton.click();
  await app.context.document.dispatch("keydown", { key: "Escape" });
  assert.equal(dialog.open, false);
  assert.equal(app.context.document.listeners.get("keydown").length, 0);
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

test("PDF export renders a printable report and triggers browser print", async () => {
  const app = createApp({ entries: [makeEntry("2026-10-08"), makeEntry("2026-10-09")] });
  let printCalled = false;
  app.context.window.print = () => {
    printCalled = true;
  };

  await app.elements.get("exportPdf").click();

  assert.equal(printCalled, true);
  assert.match(app.elements.get("printReport").innerHTML, /Schlaftagebuch – Auswertung/);
  assert.match(app.elements.get("printReport").innerHTML, /Zeitraum:/);
});
