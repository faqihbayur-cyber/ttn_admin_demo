(function initCalculator() {

  const root =
    document.getElementById(
      "calculatorRoot"
    );

  if (!root) return;

  root.innerHTML = `
    <div
      id="kalkulatorOverlay"
      class="kalkulator-overlay"
    >
      <div class="kalkulator-card">

        <div class="kalkulator-header">

          <div class="kalkulator-title">
            Kalkulator
          </div>

          <button
            id="closeCalculatorBtn"
            class="kalkulator-close"
            type="button"
          >
            ✕
          </button>

        </div>

        <input
          id="kalkulatorDisplay"
          class="kalkulator-display"
          type="text"
          value="0"
          inputmode="decimal"
          autocomplete="off"
          spellcheck="false"
        />

        <div class="kalkulator-grid">

          <button class="kalkulator-btn clear">
            C
          </button>

          <button class="kalkulator-btn">
            %
          </button>

          <button class="kalkulator-btn">
            ⌫
          </button>

          <button class="kalkulator-btn operator">
            ÷
          </button>

          <button class="kalkulator-btn">
            7
          </button>

          <button class="kalkulator-btn">
            8
          </button>

          <button class="kalkulator-btn">
            9
          </button>

          <button class="kalkulator-btn operator">
            ×
          </button>

          <button class="kalkulator-btn">
            4
          </button>

          <button class="kalkulator-btn">
            5
          </button>

          <button class="kalkulator-btn">
            6
          </button>

          <button class="kalkulator-btn operator">
            -
          </button>

          <button class="kalkulator-btn">
            1
          </button>

          <button class="kalkulator-btn">
            2
          </button>

          <button class="kalkulator-btn">
            3
          </button>

          <button class="kalkulator-btn operator">
            +
          </button>

          <button class="kalkulator-btn">
            0
          </button>

          <button class="kalkulator-btn">
            .
          </button>

          <button class="kalkulator-btn equal">
            =
          </button>

        </div>
      </div>
    </div>
  `;

  const openBtn =
    document.getElementById(
      "openCalculatorBtn"
    );

  const overlay =
    document.getElementById(
      "kalkulatorOverlay"
    );

  const closeBtn =
    document.getElementById(
      "closeCalculatorBtn"
    );

  const display =
    document.getElementById(
      "kalkulatorDisplay"
    );
  const card =
    overlay.querySelector(
      ".kalkulator-card"
    );
  
  const header =
    overlay.querySelector(
      ".kalkulator-header"
    );
  
  let isDragging =
    false;
  
  let startX = 0;
  let startY = 0;
  
  let currentX =
    window.innerWidth / 2 - 180;
  
  let currentY =
    window.innerHeight / 2 - 220;
  
  card.style.left =
    `${currentX}px`;
  
  card.style.top =
    `${currentY}px`;
  let expression =
    "";

  function formatCalculatorDisplay(
    expr
  ) {
    if (!expr) return "0";
  
    return expr.replace(
      /\d+(\.\d+)?/g,
      match => {
  
        // jangan format decimal
        if (
          match.includes(".")
        ) {
          const [
            intPart,
            decPart
          ] =
            match.split(".");
  
          return (
            Number(
              intPart
            ).toLocaleString(
              "id-ID"
            ) +
            "." +
            decPart
          );
        }
  
        return Number(
          match
        ).toLocaleString(
          "id-ID"
        );
      }
    );
  }
  
  function updateDisplay() {
  
    display.value =
      formatCalculatorDisplay(
        expression
      );
  }
  display.addEventListener(
    "input",
    () => {
  
      let value =
        display.value;
  
      // hapus format ribuan
      value =
        value.replace(
          /\./g,
          ""
        );
  
      // hanya angka & operator
      value = value.replace(
        /[^0-9+\-*/%,()]/g,
        ""
      );
  
      value = value
        .replace(/\*/g, "×")
        .replace(/\//g, "÷");
  
      expression =
        value;
  
      updateDisplay();
    }
  );
  
  display.addEventListener(
    "focus",
    () => {
  
      if (
        expression === ""
      ) {
        display.value =
          "";
      }
    }
  );
  function openCalculator() {

    overlay.classList.add(
      "show"
    );
  }

  function closeCalculator() {

    overlay.classList.remove(
      "show"
    );
  }

  function evaluateExpression() {

    try {

      const safeExpression =
        expression
          .replace(
            /×/g,
            "*"
          )
          .replace(
            /÷/g,
            "/"
          );

      const result =
        eval(
          safeExpression
        );

      expression =
        Number.isFinite(
          result
        )
          ? String(result)
          : "Error";

    } catch {

      expression =
        "Error";
    }

    updateDisplay();
  }

  openBtn?.addEventListener(
    "click",
    openCalculator
  );

  closeBtn?.addEventListener(
    "click",
    closeCalculator
  );
  // drag mouse + touch
  function startDrag(
    clientX,
    clientY
  ) {
    isDragging =
      true;
  
    startX =
      clientX -
      currentX;
  
    startY =
      clientY -
      currentY;
  }
  
  function moveDrag(
    clientX,
    clientY
  ) {
    if (
      !isDragging
    ) return;
  
    currentX =
      clientX -
      startX;
  
    currentY =
      clientY -
      startY;
  
    // batas layar
    const maxX =
      window.innerWidth -
      card.offsetWidth;
  
    const maxY =
      window.innerHeight -
      card.offsetHeight;
  
    currentX =
      Math.max(
        0,
        Math.min(
          currentX,
          maxX
        )
      );
  
    currentY =
      Math.max(
        0,
        Math.min(
          currentY,
          maxY
        )
      );
  
    card.style.left =
      `${currentX}px`;
  
    card.style.top =
      `${currentY}px`;
  }
  
  // mouse
  header.addEventListener(
    "mousedown",
    e => {
      startDrag(
        e.clientX,
        e.clientY
      );
    }
  );
  
  document.addEventListener(
    "mousemove",
    e => {
      moveDrag(
        e.clientX,
        e.clientY
      );
    }
  );
  
  document.addEventListener(
    "mouseup",
    () => {
      isDragging =
        false;
    }
  );
  
  // touch mobile
  header.addEventListener(
    "touchstart",
    e => {
  
      const touch =
        e.touches[0];
  
      startDrag(
        touch.clientX,
        touch.clientY
      );
    }
  );
  
  document.addEventListener(
    "touchmove",
    e => {
  
      const touch =
        e.touches[0];
  
      moveDrag(
        touch.clientX,
        touch.clientY
      );
    }
  );
  
  document.addEventListener(
    "touchend",
    () => {
      isDragging =
        false;
    }
  );

  const buttons =
    overlay.querySelectorAll(
      ".kalkulator-btn"
    );

  buttons.forEach(
    btn => {

      btn.addEventListener(
        "click",
        () => {

          const value =
            btn.textContent.trim();

          // clear
          if (
            value === "C"
          ) {

            expression =
              "";

            updateDisplay();

            return;
          }

          // backspace
          if (
            value === "⌫"
          ) {

            expression =
              expression.slice(
                0,
                -1
              );

            updateDisplay();

            return;
          }

          // result
          if (
            value === "="
          ) {

            evaluateExpression();

            return;
          }

          // reset kalau error
          if (
            expression ===
            "Error"
          ) {

            expression =
              "";
          }

          expression +=
            value;

          updateDisplay();
        }
      );
    }
  );
  document.addEventListener(
    "keydown",
    e => {
  
      if (
        !overlay.classList.contains(
          "show"
        )
      ) return;
  
      const key =
        e.key;
  
      // Enter = hasil
      if (
        key === "Enter"
      ) {
        e.preventDefault();
        evaluateExpression();
        return;
      }
  
      // Escape = tutup
      if (
        key === "Escape"
      ) {
        closeCalculator();
        return;
      }
  
      // Backspace
      if (
        key ===
        "Backspace"
      ) {
  
        expression =
          expression.slice(
            0,
            -1
          );
  
        updateDisplay();
  
        return;
      }
  
      // angka & operator
      if (
        /[0-9+\-*/%.()]/.test(
          key
        )
      ) {
  
        if (
          expression ===
          "Error"
        ) {
          expression =
            "";
        }
  
        expression +=
          key
            .replace(
              "*",
              "×"
            )
            .replace(
              "/",
              "÷"
            );
  
        updateDisplay();
      }
    }
  );
})();