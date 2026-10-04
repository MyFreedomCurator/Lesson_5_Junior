// ============ НАСТРОЙКА ============
// Вставьте сюда URL вашего Google Apps Script Web App
const GOOGLE_SHEETS_URL = "https://script.google.com/macros/s/AKfycbzj74DvVjVt_MUXCuQ4lgU1VditftNB81aXy4lEqzXBU3kMCHJ7RzQ4Cl0nWoVpFpxS/exec";
// ==================================

let pyodide = null;
let currentTask = null;

// ---------- Инициализация Pyodide ----------
async function initPython() {
  try {
    pyodide = await loadPyodide({
      stdout: (text) => appendOutput(text),
      stderr: (text) => appendError(text),
    });
    document.getElementById("loading").style.display = "none";
    document.getElementById("app").style.display = "grid";
    renderTaskList();
    selectTask(TASKS[0].id);
  } catch (e) {
    document.getElementById("loading").innerHTML =
      `<p style="color:#ef4444">Ошибка загрузки Python: ${e.message}</p>`;
  }
}

// ---------- Имя ученика ----------
const studentInput = document.getElementById("student-name");
studentInput.value = localStorage.getItem("student_name") || "";
studentInput.addEventListener("input", () => {
  localStorage.setItem("student_name", studentInput.value);
});

function getStudentName() {
  return (studentInput.value || "Аноним").trim();
}

// ---------- Список задач ----------
function renderTaskList() {
  const ul = document.getElementById("task-list");
  ul.innerHTML = "";
  TASKS.forEach((t) => {
    const li = document.createElement("li");
    li.textContent = t.title;
    li.dataset.id = t.id;
    li.onclick = () => selectTask(t.id);
    ul.appendChild(li);
  });
}

function selectTask(id) {
  currentTask = TASKS.find((t) => t.id === id);
  if (!currentTask) return;

  document.querySelectorAll("#task-list li").forEach((li) => {
    li.classList.toggle("active", li.dataset.id === id);
  });

  document.getElementById("task-title").textContent = currentTask.title;
  document.getElementById("task-desc").textContent = currentTask.desc;

  // Отображаем только НАЗВАНИЯ переменных и их типы — без значений
  const varsBox = document.getElementById("task-vars");
  varsBox.innerHTML = "";
  if (currentTask.vars && currentTask.vars.length) {
    currentTask.vars.forEach((v) => {
      const chip = document.createElement("div");
      chip.className = "var-chip";
      chip.innerHTML = `${v.name} <span class="type-tag">${v.type}</span>`;
      varsBox.appendChild(chip);
    });
  } else {
    varsBox.textContent = "Нет переменных (напишите код с нуля).";
    varsBox.style.color = "var(--muted)";
  }

  const saved = localStorage.getItem("code_" + id);
  document.getElementById("code-input").value = saved || currentTask.starter || "";

  hideOutput();
  hideHint();
}

// ---------- Сохранение кода ----------
document.addEventListener("input", (e) => {
  if (e.target.id === "code-input" && currentTask) {
    localStorage.setItem("code_" + currentTask.id, e.target.value);
  }
});

// ---------- Вывод ----------
let outputBuffer = [];
let errorBuffer = [];

function appendOutput(text) { outputBuffer.push(text); }
function appendError(text) { errorBuffer.push(text); }

function showOutput(msg, isError = false) {
  const box = document.getElementById("output");
  const content = document.getElementById("output-content");
  content.textContent = msg;
  box.className = "output " + (isError ? "err" : "ok");
  box.style.display = "block";
}
function hideOutput() { document.getElementById("output").style.display = "none"; }
function showHint() {
  const h = document.getElementById("hint");
  h.textContent = "💡 " + (currentTask.hint || "Подсказки нет.");
  h.style.display = "block";
}
function hideHint() { document.getElementById("hint").style.display = "none"; }

// ---------- Перевод ошибок на русский ----------
function translateError(err) {
  const text = err.toString();
  const map = [
    [/SyntaxError: invalid syntax/i, "Синтаксическая ошибка: неверный синтаксис. Проверьте скобки, кавычки и двоеточия."],
    [/SyntaxError: unexpected EOF/i, "Синтаксическая ошибка: неожиданный конец файла. Возможно, не закрыта скобка или кавычка."],
    [/IndentationError: expected an indented block/i, "Ошибка отступа: ожидается блок с отступом после двоеточия."],
    [/IndentationError: unexpected indent/i, "Ошибка отступа: лишний отступ."],
    [/NameError: name '(\w+)' is not defined/i, "Ошибка имени: переменная '$1' не определена. Проверьте, объявлена ли она."],
    [/TypeError: (.*)/i, "Ошибка типа: $1"],
    [/ValueError: (.*)/i, "Ошибка значения: $1"],
    [/ZeroDivisionError/i, "Ошибка: деление на ноль."],
    [/IndexError: list index out of range/i, "Ошибка индекса: выход за границы списка."],
    [/KeyError: (.*)/i, "Ошибка ключа: ключ $1 не найден."],
    [/AttributeError: (.*)/i, "Ошибка атрибута: $1"],
    [/ModuleNotFoundError: No module named '(\w+)'/i, "Модуль '$1' не найден."],
  ];
  for (const [re, ru] of map) {
    if (re.test(text)) {
      return text.replace(re, ru) + "\n\n📖 Оригинал:\n" + text;
    }
  }
  return text;
}

// ---------- Отправка в Google Sheets ----------
async function logToSheets(payload) {
  if (!GOOGLE_SHEETS_URL || GOOGLE_SHEETS_URL.includes("ВСТАВЬТЕ")) {
    console.warn("Google Sheets URL не настроен — лог пропущен.");
    return { ok: false, reason: "not-configured" };
  }
  try {
    // Используем text/plain, чтобы избежать CORS preflight
    const res = await fetch(GOOGLE_SHEETS_URL, {
      method: "POST",
      mode: "no-cors", // Apps Script не отдаёт CORS-заголовки
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
    });
    // При mode:"no-cors" ответ прочитать нельзя — считаем успех по отсутствию исключения
    return { ok: true };
  } catch (err) {
    console.error("Ошибка отправки в таблицу:", err);
    return { ok: false, reason: err.message };
  }
}

function setLogStatus(text, cls) {
  let el = document.getElementById("log-status");
  if (!el) {
    el = document.createElement("span");
    el.id = "log-status";
    el.className = "log-status";
    document.querySelector(".actions").appendChild(el);
  }
  el.textContent = text;
  el.className = "log-status " + (cls || "");
  if (text) {
    clearTimeout(el._timer);
    el._timer = setTimeout(() => { el.textContent = ""; }, 4000);
  }
}

// ---------- Выполнение кода ----------
async function runUserCode(check = false) {
  if (!pyodide || !currentTask) return;
  const code = document.getElementById("code-input").value;

  outputBuffer = [];
  errorBuffer = [];

  const runBtn = document.getElementById("run-btn");
  const checkBtn = document.getElementById("check-btn");
  runBtn.disabled = checkBtn.disabled = true;

  let logOutput = "";
  let logError = "";
  let logCheck = "";

  try {
    const fullCode = currentTask.setup + "\n" + code;
    await pyodide.runPythonAsync(fullCode);

    const stdout = outputBuffer.join("\n").trim();
    logOutput = stdout;

    if (errorBuffer.length > 0) {
      logError = errorBuffer.join("\n");
      showOutput("⚠ Предупреждение:\n" + logError, true);
    } else if (check) {
      logCheck = await checkSolution(stdout);
    } else {
      showOutput(stdout ? "Вывод программы:\n" + stdout : "(нет вывода — используйте print())");
    }
  } catch (err) {
    const translated = translateError(err.message || err);
    logError = translated;
    showOutput("❌ " + translated, true);
  } finally {
    runBtn.disabled = checkBtn.disabled = false;

    // Отправляем в Google Sheets в любом случае
    setLogStatus("Отправка…", "");
    const res = await logToSheets({
      student: getStudentName(),
      task: currentTask.title,
      taskId: currentTask.id,
      code: code,
      output: logOutput,
      error: logError,
      check: check ? logCheck : "",
      mode: check ? "check" : "run",
    });
    if (res.ok) setLogStatus("✓ Записано в таблицу", "ok");
    else setLogStatus("⚠ Не отправлено", "err");
  }
}

// ---------- Проверка решения ----------
async function checkSolution(stdout) {
  const expected = currentTask.expected || {};
  const checks = [];

  for (const [varName, expectedVal] of Object.entries(expected)) {
    const pyVal = pyodide.globals.get(varName);
    let actual;
    try {
      actual = pyVal?.toJs ? pyVal.toJs() : pyVal;
    } catch {
      actual = pyVal;
    }
    if (pyVal && typeof pyVal === "object" && pyVal.toString) {
      const s = pyVal.toString();
      if (s === "None") actual = null;
    }

    const ok = JSON.stringify(actual) === JSON.stringify(expectedVal);
    checks.push({ varName, ok, actual, expectedVal });
  }

  if (checks.length === 0) {
    const msg = "✓ Код выполнен. (Для этой задачи автопроверка не задана.)\n\n" + stdout;
    showOutput(msg);
    return "нет автопроверки";
  }

  const allOk = checks.every((c) => c.ok);
  let msg = allOk ? "✅ Верно! Все проверки пройдены.\n\n" : "❌ Есть ошибки:\n\n";
  checks.forEach((c) => {
    msg += `${c.ok ? "✓" : "✗"} переменная "${c.varName}": ожидалось ${JSON.stringify(c.expectedVal)}, получено ${JSON.stringify(c.actual)}\n`;
  });
  if (stdout) msg += "\nВывод программы:\n" + stdout;

  showOutput(msg, !allOk);
  return allOk ? "ВЕРНО" : checks.map(c => `${c.varName}: ${c.ok ? "✓" : "✗"}`).join(", ");
}

// ---------- Кнопки ----------
document.getElementById("run-btn").onclick = () => runUserCode(false);
document.getElementById("check-btn").onclick = () => runUserCode(true);
document.getElementById("hint-btn").onclick = showHint;
document.getElementById("reset-btn").onclick = () => {
  if (currentTask && confirm("Сбросить код к начальному шаблону?")) {
    document.getElementById("code-input").value = currentTask.starter || "";
    localStorage.removeItem("code_" + currentTask.id);
    hideOutput(); hideHint();
  }
};

// Tab внутри textarea
document.getElementById("code-input").addEventListener("keydown", (e) => {
  if (e.key === "Tab") {
    e.preventDefault();
    const ta = e.target;
    const start = ta.selectionStart;
    ta.value = ta.value.substring(0, start) + "    " + ta.value.substring(ta.selectionEnd);
    ta.selectionStart = ta.selectionEnd = start + 4;
  }
});

// Старт
initPython();
