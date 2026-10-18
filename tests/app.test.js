const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const appSource = fs.readFileSync(
  path.join(__dirname, "../schlaf-tagebuch/app.js"),
  "utf8"
);
const htmlSource = fs.readFileSync(
  path.join(__dirname, "../schlaf-tagebuch/index.html"),
  "utf8"
);
const cssSource = fs.readFileSync(
  path.join(__dirname, "../schlaf-tagebuch/styles.css"),
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
    this.hidden = false;
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
    return this.dispatch("close");
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
  prefersReducedMotion = false,
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
    "sheepTrack", "sheepCounter", "sheepFinale", "wakeSheep", "morningSheepDialog",
    "closeMorningSheep", "restartMorningSheep", "doneMorningSheep", "morningScene",
    "morningMessage", "morningFinale", "qualityText", "notes", "save",
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
  const timers = [];
  const createdElements = [];
  const createdObjectUrls = [];
  const revokedObjectUrls = [];
  const confirmations = [];
  let nextTimerId = 0;
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
    createElement: (tag) => {
      const element = new FakeElement(tag);
      createdElements.push(element);
      return element;
    },
  };
  const alerts = [];
  const context = vm.createContext({
    document,
    localStorage: storage,
    alert: (message) => alerts.push(message),
    confirm: (message) => {
      confirmations.push(message);
      return confirm;
    },
    setTimeout: (callback, delay) => {
      const timer = { id: nextTimerId, callback, delay, cancelled: false };
      nextTimerId += 1;
      timers.push(timer);
      return timer.id;
    },
    clearTimeout: (id) => {
      const timer = timers.find((candidate) => candidate.id === id);
      if (timer) timer.cancelled = true;
    },
    window: { print: () => {}, matchMedia: () => ({ matches: prefersReducedMotion }) },
    Blob: class {
      constructor(parts, options) {
        this.parts = parts;
        this.options = options;
      }
    },
    URL: {
      createObjectURL: (blob) => {
        const url = `blob:test-${createdObjectUrls.length}`;
        createdObjectUrls.push({ url, blob });
        return url;
      },
      revokeObjectURL: (url) => revokedObjectUrls.push(url),
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
  return {
    context,
    elements,
    alerts,
    storage,
    stars,
    tabs,
    views,
    runNextTimeout: () => {
      const timer = timers.find((candidate) => !candidate.cancelled && !candidate.fired);
      if (!timer) return false;
      timer.fired = true;
      timer.callback();
      return true;
    },
    timers,
    createdElements,
    createdObjectUrls,
    revokedObjectUrls,
    confirmations,
  };
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
  vm.runInContext(
    "loadEntryIntoForm(entries.find(entry => entry.date === '2026-10-08'))",
    app.context
  );
  fillEntryForm(app, "2026-10-09");

  await app.elements.get("save").click();

  assert.deepEqual(storedEntries(app), initial);
  assert.match(app.alerts.at(-1), /bereits einen Eintrag/);
});

test("invalid dates and durations are rejected without saving", async () => {
  const app = createApp();
  fillEntryForm(app, "2026-02-30");
  await app.elements.get("save").click();
  assert.equal(app.storage.getItem("schlaftagebuch.entries.v1"), "[]");
  assert.deepEqual(
    JSON.parse(vm.runInContext("JSON.stringify(entries)", app.context)),
    []
  );

  fillEntryForm(app);
  app.elements.get("awake").value = "485";
  await app.elements.get("save").click();
  assert.deepEqual(storedEntries(app), []);
});

test("time inputs remain native and calculate overnight durations", async () => {
  for (const id of ["bed", "wake", "defaultStart", "defaultEnd"]) {
    assert.match(htmlSource, new RegExp(`<input id="${id}" type="time"`));
    assert.doesNotMatch(htmlSource.match(new RegExp(`<input id="${id}"[^>]*>`))?.[0] || "", /inputmode=/);
  }
  assert.doesNotMatch(cssSource, /appearance\s*:/);

  const app = createApp();
  app.elements.get("bed").value = "23:30";
  app.elements.get("wake").value = "06:00";
  app.elements.get("awake").value = "30";
  await app.elements.get("wake").dispatch("input");
  assert.equal(app.elements.get("sleepCalc").textContent, "6 h 30 min");
  assert.equal(app.elements.get("effectiveCalc").textContent, "6 h 00 min");

  app.elements.get("wake").value = "";
  await app.elements.get("wake").dispatch("input");
  assert.equal(app.elements.get("sleepCalc").textContent, "–");
  assert.equal(app.elements.get("effectiveCalc").textContent, "–");
});

test("identical bed and wake times are rejected on save and import", async () => {
  const app = createApp();
  fillEntryForm(app);
  app.elements.get("wake").value = "23:00";
  await app.elements.get("save").click();
  assert.deepEqual(storedEntries(app), []);
  assert.match(app.alerts.at(-1), /dürfen nicht identisch sein/);

  app.elements.get("importRawData").value = JSON.stringify({
    entries: [makeEntry("2026-10-09", { bed: "07:00", wake: "07:00", total: 0, effective: 0 })],
  });
  await app.elements.get("restoreRaw").click();
  assert.deepEqual(storedEntries(app), []);
  assert.match(app.alerts.at(-1), /ungültige oder unvollständige Daten/);
});

test("stored entries are sorted newest first before history and seven-night statistics", () => {
  const unsortedEntries = [
    makeEntry("2026-10-01"),
    makeEntry("2026-10-09"),
    makeEntry("2026-10-05"),
  ];
  const app = createApp({ entries: unsortedEntries });

  assert.deepEqual(
    JSON.parse(vm.runInContext("JSON.stringify(entries.map(entry => entry.date))", app.context)),
    ["2026-10-09", "2026-10-05", "2026-10-01"]
  );
  assert.ok(
    app.elements.get("historyList").innerHTML.indexOf("09.10.2026") <
      app.elements.get("historyList").innerHTML.indexOf("01.10.2026")
  );
});

test("statistics use only the seven newest nights and handle empty records", () => {
  const entries = Array.from({ length: 8 }, (_, index) => {
    const day = String(index + 1).padStart(2, "0");
    return makeEntry(`2026-10-${day}`, {
      effective: index === 0 ? 0 : 420,
      awake: index === 0 ? 480 : 60,
    });
  }).reverse();
  const app = createApp({ entries });

  assert.match(app.elements.get("statCards").innerHTML, /Ø Effektive Schlafdauer/);
  assert.match(app.elements.get("statCards").innerHTML, /7 h 00 min/);
  assert.match(app.elements.get("statCards").innerHTML, /<b>7<\/b>/);
  assert.equal((app.elements.get("chart").innerHTML.match(/class="bar"/g) || []).length, 7);

  const emptyApp = createApp();
  assert.match(emptyApp.elements.get("statCards").innerHTML, /Noch keine Daten/);
  assert.equal(emptyApp.elements.get("chart").innerHTML, "");
});

test("shared sleep statistics omit missing quality values from their average", () => {
  const app = createApp();
  const stats = vm.runInContext(
    `calculateSleepStatistics([
      { total: 480, effective: 420, awake: 60, quality: 4 },
      { total: 420, effective: 360, awake: 60, quality: null },
      { total: 420, effective: 360, awake: 60 }
    ])`,
    app.context
  );

  assert.equal(stats.nights, 3);
  assert.equal(stats.averageTotal, 440);
  assert.equal(stats.averageEffective, 380);
  assert.equal(stats.averageAwake, 60);
  assert.equal(stats.averageQuality, 4);
  assert.equal(
    vm.runInContext("calculateSleepStatistics([]).averageQuality", app.context),
    null
  );
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

test("morning sheep stays on Today, runs through its phases, restarts and restores focus", async () => {
  const todayMarkup = htmlSource.match(/<section id="today"[\s\S]*?<\/section>/)?.[0] || "";
  assert.match(todayMarkup, /id="countSheep"/);
  assert.match(todayMarkup, /id="wakeSheep" aria-label="Schaf aufwecken"/);
  assert.doesNotMatch(htmlSource.match(/<section id="(?:history|stats|settings)"[\s\S]*?<\/section>/)?.[0] || "", /id="wakeSheep"/);
  assert.match(cssSource, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(cssSource, /\.morning-scene--ready \.morning-eyes-closed/);

  const app = createApp();
  const button = app.elements.get("wakeSheep");
  const dialog = app.elements.get("morningSheepDialog");
  const closeButton = app.elements.get("closeMorningSheep");
  const scene = app.elements.get("morningScene");
  const message = app.elements.get("morningMessage");
  app.context.document.activeElement = button;

  await button.click();
  assert.equal(dialog.open, true);
  assert.equal(closeButton.focused, true);
  assert.equal(message.textContent, "Nur noch fünf Minuten …");
  assert.equal(scene.classList.contains("morning-scene--sleeping"), true);
  assert.equal(app.timers.at(-1).delay, 3000);

  for (const expectedState of [
    "waking",
    "sitting",
    "flopping",
    "negotiating",
    "standing",
    "ready",
  ]) {
    assert.equal(app.runNextTimeout(), true);
    assert.equal(scene.classList.contains(`morning-scene--${expectedState}`), true);
  }

  assert.equal(app.elements.get("morningFinale").hidden, false);
  assert.match(htmlSource, /Aufgestanden\. Das reicht für den Anfang\./);
  assert.equal(app.elements.get("restartMorningSheep").hidden, false);
  assert.equal(app.elements.get("doneMorningSheep").hidden, false);

  await app.elements.get("restartMorningSheep").click();
  assert.equal(message.textContent, "Nur noch fünf Minuten …");
  assert.equal(app.timers.at(-1).delay, 3000);
  assert.equal(app.elements.get("morningFinale").hidden, true);
  assert.equal(app.elements.get("doneMorningSheep").hidden, true);

  await closeButton.click();
  assert.equal(dialog.open, false);
  assert.equal(button.focused, true);
  assert.equal(scene.classList.contains("morning-scene--sleeping"), false);
  assert.equal(app.timers.filter((timer) => !timer.cancelled && !timer.fired).length, 0);

  await button.click();
  await app.context.document.dispatch("keydown", { key: "Escape" });
  assert.equal(dialog.open, false);
  assert.equal(app.context.document.listeners.get("keydown").length, 0);
});

test("morning sheep keeps readable pauses with reduced motion", async () => {
  const app = createApp({ prefersReducedMotion: true });
  await app.elements.get("wakeSheep").click();

  assert.equal(app.timers.at(-1).delay, 1800);
  assert.equal(app.elements.get("morningMessage").textContent, "Nur noch fünf Minuten …");
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

test("failed import restores prior settings and leaves diary data unchanged", async () => {
  const initialEntries = [makeEntry("2026-10-08")];
  const initialSettings = { start: "22:30", end: "06:30" };
  const app = createApp({
    entries: initialEntries,
    settings: initialSettings,
    failSetFor: "schlaftagebuch.entries.v1",
  });
  app.elements.get("importRawData").value = JSON.stringify({
    entries: [makeEntry("2026-10-09")],
    settings: { start: "23:30", end: "07:30" },
  });

  await app.elements.get("restoreRaw").click();

  assert.deepEqual(storedEntries(app), initialEntries);
  assert.deepEqual(JSON.parse(app.storage.getItem("schlaftagebuch.settings.v1")), initialSettings);
  assert.deepEqual(
    JSON.parse(vm.runInContext("JSON.stringify(entries.map(entry => entry.date))", app.context)),
    ["2026-10-08"]
  );
  assert.match(app.alerts.at(-1), /Die bisherigen Daten wurden beibehalten/);
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
  const savedSettings = { start: "22:00", end: "06:00" };
  const app = createApp({ entries: [makeEntry("2026-10-08")], settings: savedSettings });
  app.elements.get("defaultStart").value = "22:00";
  app.elements.get("defaultEnd").value = "06:00";
  await app.elements.get("saveSettings").click();
  assert.equal(JSON.parse(app.storage.getItem("schlaftagebuch.settings.v1")).start, "22:00");

  await app.elements.get("export").click();
  assert.equal(app.elements.get("export").clicked, true);
  assert.equal(app.createdObjectUrls.length, 1);
  assert.deepEqual(app.revokedObjectUrls, []);
  const exportedJson = app.createdObjectUrls[0].blob.parts[0];
  const exportedData = JSON.parse(exportedJson);
  assert.deepEqual(exportedData.settings, savedSettings);
  assert.deepEqual(exportedData.entries.map((entry) => entry.date), ["2026-10-08"]);
  assert.deepEqual(
    JSON.parse(vm.runInContext(`JSON.stringify(parseImportData(${JSON.stringify(exportedJson)}))`, app.context))
      .entries.map((entry) => entry.date),
    ["2026-10-08"]
  );
  const releaseTimer = app.timers.find((timer) => !timer.cancelled && !timer.fired);
  assert.equal(releaseTimer.delay, 1000);
  releaseTimer.fired = true;
  releaseTimer.callback();
  assert.deepEqual(app.revokedObjectUrls, [app.createdObjectUrls[0].url]);

  await app.elements.get("cancelImport").click();
  assert.equal(app.elements.get("importDialog").open, false);
  await app.tabs.find((tab) => tab.dataset.view === "history").click();
  assert.equal(app.views.find((view) => view.id === "history").classes.has("active"), true);

  await app.elements.get("clear").click();
  assert.equal(app.storage.getItem("schlaftagebuch.entries.v1"), null);
  assert.deepEqual(JSON.parse(app.storage.getItem("schlaftagebuch.settings.v1")), savedSettings);
  assert.match(app.confirmations.at(-1), /Schlafeinträge löschen/);
  assert.match(app.confirmations.at(-1), /Einstellungen bleiben erhalten/);
  assert.match(htmlSource, /id="clear">Alle Einträge löschen/);
});

test("PDF export renders a printable report and triggers browser print", async () => {
  const app = createApp({
    entries: Array.from({ length: 10 }, (_, index) => {
      const day = String(index + 1).padStart(2, "0");
      return makeEntry(`2026-10-${day}`, {
        total: 480 - index * 5,
        effective: 420 - index * 5,
        awake: 60,
        quality: index % 5 + 1,
      });
    }),
  });
  let printCalled = false;
  app.context.window.print = () => {
    printCalled = true;
  };

  await app.elements.get("exportPdf").click();

  assert.equal(printCalled, true);
  const report = app.elements.get("printReport").innerHTML;
  assert.match(report, /<h1>Schlaftagebuch<\/h1>/);
  assert.match(report, /Zeitraum:/);
  assert.match(report, /Ø Gesamte Schlafdauer<\/span>\s*<strong>7 h 38 min/);
  assert.match(report, /Ø Effektive Schlafdauer<\/span>\s*<strong>6 h 38 min/);
  assert.match(report, /Ø Qualität<\/span>\s*<strong>3\.0 \/ 5/);
  assert.match(report, /Erfasste Nächte<\/span>\s*<strong>10/);
  assert.match(report, /<th>Ins Bett gegangen<\/th>\s*<th>Aufgestanden<\/th>\s*<th>Gesamte Schlafdauer<\/th>\s*<th>Wachzeit<\/th>\s*<th>Effektive Schlafdauer<\/th>/);
  assert.doesNotMatch(report, /Eingeschlafen|Einschlafzeit|nicht erfasst/);
  assert.match(report, /Effektive Schlafdauer – letzte 7 Nächte/);
  const reportRows = [...report.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map(([, row]) => row);
  assert.match(reportRows[1], /<td>23:00<\/td>\s*<td>07:00<\/td>\s*<td>8 h 00 min<\/td>\s*<td>60 min<\/td>\s*<td>7 h 00 min<\/td>/);
  assert.match(reportRows[10], /<td>7 h 15 min<\/td>\s*<td>60 min<\/td>\s*<td>6 h 15 min<\/td>/);
  assert.equal((report.match(/class="bar"/g) || []).length, 7);
  assert.match(cssSource, /size:\s*A4 landscape/);
  assert.match(cssSource, /table-layout:\s*fixed/);
  assert.match(cssSource, /break-inside:\s*avoid/);
  assert.match(cssSource, /table-header-group/);
  assert.match(cssSource, /\.print-report__document\s*\{[^}]*color:\s*#172033/s);
  assert.match(cssSource, /\.print-report__header\s*\{[^}]*position:\s*static/s);
});

test("empty PDF report shows dashes instead of invalid summary values and omits its chart", async () => {
  const app = createApp();
  await app.elements.get("exportPdf").click();

  const report = app.elements.get("printReport").innerHTML;
  assert.match(report, /Keine Einträge/);
  assert.match(report, /Ø Gesamte Schlafdauer<\/span>\s*<strong>–/);
  assert.match(report, /Ø Effektive Schlafdauer<\/span>\s*<strong>–/);
  assert.match(report, /Ø Wachzeit<\/span>\s*<strong>–/);
  assert.match(report, /Ø Qualität<\/span>\s*<strong>–/);
  assert.match(report, /colspan="7"/);
  assert.doesNotMatch(report, /class="bar"/);
  assert.doesNotMatch(report, /letzte 0 Nächte/);
});

test("single-night PDF reports its averages, chronological range and one chart bar", async () => {
  const app = createApp({
    entries: [makeEntry("2026-10-18", { total: 465, effective: 430, awake: 35, quality: 5 })],
  });
  await app.elements.get("exportPdf").click();

  const report = app.elements.get("printReport").innerHTML;
  assert.match(report, /Ø Gesamte Schlafdauer<\/span>\s*<strong>7 h 45 min/);
  assert.match(report, /Ø Effektive Schlafdauer<\/span>\s*<strong>7 h 10 min/);
  assert.match(report, /Ø Wachzeit<\/span>\s*<strong>35 min/);
  assert.match(report, /Ø Qualität<\/span>\s*<strong>5\.0 \/ 5/);
  assert.match(report, /letzte 1 Nächte/);
  assert.equal((report.match(/class="bar"/g) || []).length, 1);
  assert.match(report, /18\.10\.2026 – 18\.10\.2026/);
});

test("clearing sleep entries requires confirmation and preserves entries when declined", async () => {
  const initial = [makeEntry("2026-10-08")];
  const settings = { start: "22:30", end: "06:30" };
  const app = createApp({ entries: initial, settings, confirm: false });

  await app.elements.get("clear").click();

  assert.deepEqual(storedEntries(app), initial);
  assert.deepEqual(JSON.parse(app.storage.getItem("schlaftagebuch.settings.v1")), settings);
});

test("confirmed clearing removes entries, preserves settings and resets an edited form", async () => {
  const initial = [makeEntry("2026-10-08")];
  const settings = { start: "22:30", end: "06:30" };
  const app = createApp({ entries: initial, settings });
  vm.runInContext("loadEntryIntoForm(entries[0])", app.context);
  assert.equal(app.elements.get("bed").value, "23:00");

  await app.elements.get("clear").click();

  assert.equal(app.storage.getItem("schlaftagebuch.entries.v1"), null);
  assert.deepEqual(
    JSON.parse(vm.runInContext("JSON.stringify(entries)", app.context)),
    []
  );
  assert.deepEqual(JSON.parse(app.storage.getItem("schlaftagebuch.settings.v1")), settings);
  assert.equal(app.elements.get("bed").value, "");
  assert.equal(vm.runInContext("editingDate", app.context), null);
});
