let code = "";
const input = document.getElementById("codigoInput");

function updateDots() {
  for (let i = 1; i <= 4; i++) {
    document.getElementById("dot" + i).classList.toggle("filled", i <= code.length);
  }
}

function addDigit(d) {
  if (code.length < 4) {
    code += d;
    input.value = code;
    updateDots();
    if (code.length === 4) {
      setTimeout(() => {
        document.getElementById("codeForm").submit();
      }, 200);
    }
  }
}

function clearAll() {
  code = "";
  input.value = "";
  updateDots();
}

function removeLast() {
  code = code.slice(0, -1);
  input.value = code;
  updateDots();
}