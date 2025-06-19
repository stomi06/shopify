document.addEventListener("DOMContentLoaded", function () {
  const FREE_SHIPPING_THRESHOLD = 20000; // 200 zł w groszach
  let banner = document.createElement("div");

  function updateBanner() {
    fetch("/cart.js")
      .then((res) => res.json())
      .then((cart) => {
        const subtotal = cart.items_subtotal_price;
        const remaining = FREE_SHIPPING_THRESHOLD - subtotal;

        if (remaining > 0) {
          const remainingFormatted = (remaining / 100).toFixed(2).replace(".", ",");
          banner.textContent = `Dodaj jeszcze ${remainingFormatted} zł, aby otrzymać darmową dostawę!`;
        } else {
          banner.textContent = `Masz już darmową dostawę! 🎉`;
        }
      });
  }

  Object.assign(banner.style, {
    position: "fixed",
    top: 0,
    left: 0,
    width: "100%",
    background: "#2e7d32",
    color: "white",
    fontSize: "16px",
    fontWeight: "bold",
    padding: "12px",
    textAlign: "center",
    zIndex: 9999,
    fontFamily: "Arial, sans-serif",
  });

  document.body.prepend(banner);
  document.body.style.paddingTop = "48px";

  updateBanner();
  setInterval(updateBanner, 3000);
});
