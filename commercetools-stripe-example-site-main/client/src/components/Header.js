import React, { useState, useEffect } from "react";
import Helmet from "react-helmet";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faShoppingCart } from "@fortawesome/free-solid-svg-icons";
import { Link } from "react-router-dom";

export default function Header(props) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [shopName, setShopName] = useState();
  const [shopIcon, setShopIcon] = useState("logo.svg");

  const styles = {
    top: {
      borderTop: "20px solid " + props.brandColor,
      marginTop: 30,
      paddingTop: 20,
      marginBottom: 40,
    },
    cart: {
      color: props.brandColor,
      textAlign: "right",
      fontSize: "2em",
      marginTop: 30,
    },
    title: {
      color: props.brandColor,
      fontSize: "4em",
      letterSpacing: "-2px",
      fontWeight: 400,
    },
    subtitle: {
      fontSize: "1.5rem",
      fontStyle: "italic",
    },
    icon: {
      height: 70,
      float: "left",
      margin: "10px 20px 10px 10px",
    },
    switcher: {
      border: 0,
      marginRight: 30,
    },
  };

  // On intitial load only, retrieve branding details
  useEffect(() => {
    fetch("/settings/")
      .then((res) => res.json())
      .then((data) => {
        setShopName(data.shop_name);
        if (data.icon) setShopIcon(data.icon);
        props.setBrandColor(data.primary_color);
      })
      .then(() => setIsLoaded(true));
  }, []);

  // On changing the currency, empty the cart
  useEffect(() => {
    props.resetCart();
  }, [props.currency]);

  if (isLoaded) {
    return (
      <>
        <Helmet>
          <title>{shopName}</title>
        </Helmet>
        <div className="row" style={styles.top}>
          <div className="col-8">
            <a href="/">
              <img src={shopIcon} style={styles.icon} alt="icon" />
            </a>
          </div>
          {props.showCart && (
            <div className="col-4 align-text-bottom" style={styles.cart}>
              <select
                onChange={props.pickCurrency}
                value={props.currency}
                style={styles.switcher}
              >
                <option value="eur">€</option>
                <option value="gbp">£</option>
              </select>
              <Link
                to="/checkout"
                style={{ textDecoration: "none", color: "inherit" }}
              >
                <FontAwesomeIcon icon={faShoppingCart} />{" "}
                {props.cart?.lineItems.length ? props.cart.lineItems.length : 0}
              </Link>
            </div>
          )}
        </div>
      </>
    );
  } else {
    return "";
  }
}
