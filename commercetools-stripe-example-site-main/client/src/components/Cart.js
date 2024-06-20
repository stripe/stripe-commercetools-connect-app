import React from "react";

export default function Cart(props) {
  const styles = {
    header: {
      marginBottom: 15,
    },
    preview: {
      height: 80,
    },
    item: {
      marginBottom: 20,
    },
    panel: {
      border: "1px solid silver",
      borderRadius: 4,
      padding: "20px 20px 0px 20px",
      boxShadow: "silver 0px 0px 6px 0px",
    },
  };

  const displayPrice = (amount) => {
    return amount.toLocaleString("en-US", {
      style: "currency",
      currency: props.currency,
    });
  };

  return (
    <>
      <h4 style={styles.header}>Your Cart</h4>
      {props.cart && (
        <div style={styles.panel}>
          {props.cart.lineItems.map((item, key) => (
            <div className="row" key={key} style={styles.item}>
              <div className="col-4">
                <img
                  alt="shopping cart item"
                  style={styles.preview}
                  src={item.variant.images[0].url}
                />
              </div>
              <div className="col-4">{item.name["en-US"]}</div>
              <div className="col-2">
                {displayPrice(
                  (item.price.value.centAmount / 100).toFixed(
                    item.price.value.fractionDigits
                  )
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {!props.cart && <div className="row">Your cart is empty</div>}
    </>
  );
}
