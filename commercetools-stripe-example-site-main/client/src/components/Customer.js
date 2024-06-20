import React, { useState, useEffect } from "react";
import {
  CountryDropdown,
  CountryRegionData,
} from "react-country-region-selector";

export default function Customer(props) {
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("");
  const [custExists, setCustExists] = useState(false);

  const styles = {
    header: {
      marginBottom: 15,
    },
    intro: {
      fontSize: "smaller",
    },
    panel: {
      border: "1px solid silver",
      borderRadius: 4,
      padding: "20px 20px 10px 20px",
      boxShadow: "silver 0px 0px 6px 0px",
    },
    receipt: {
      display: "inline",
      fontWeight: 600,
    },
    clickable: {
      cursor: "pointer",
    },
  };

  const doNothing = () => {};

  const resetCustomer = () => {
    props.setCustId("");
    setCustExists(false);
    setEmail("");
    setName("");
    setAddress("");
    setCity("");
    setCountry("");
  };

  const checkCustomerExists = (e) => {
    fetch("/customer/" + e.target.value)
      .then((res) => res.json())
      .then((data) => {
        props.setCustId(data.id);
        data.id && addCustomerToCart(data.id);
        setCustExists(data.id !== "");
        setName(data.name);
        setAddress(data.address);
        setCity(data.city);
        setCountry(data.country);
      });
  };

  const addCustomerToCart = async (customerId) => {
    fetch("/cart/customer", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        cartId: props.cart.id,
        customerId: customerId,
      }),
    })
      .then((res) => res.json())
      .then((data) => {
        props.setCart(data);
      });
  };

  const createCustomer = async (e) => {
    e.preventDefault();
    setLoading(true);
    fetch("/customer", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: email,
        name: name,
        address: address,
        city: city,
        country: country,
        cartId: props.cart.id,
      }),
    })
      .then((res) => res.json())
      .then((data) => {
        props.setCustId(data.id);
        addCustomerToCart(data.id);
        setCustExists(true);
        setName(data.name);
        setAddress(data.address);
        setCity(data.city);
        setCountry(data.country);
        setLoading(false);
      });
  };

  // Send all the customer info back to the parent page
  useEffect(() => {
    props.setCustInfo({
      name: name,
      address: address,
      city: city,
      country: country,
      email: email,
    });
  }, [name, address, city, country, email]);

  return (
    <>
      <h4 style={styles.header}>Your Information</h4>
      <div style={styles.panel}>
        <div className="row mb-2">
          <div className="col">
            <label htmlFor="email">Email</label>
            <input
              type="text"
              className="form-control"
              id="email"
              onChange={(e) => setEmail(e.target.value)}
              onBlur={checkCustomerExists}
              value={email}
            />
          </div>
          <div className="col">
            <label htmlFor="name">Password (N/A)</label>
            <input
              type="password"
              className="form-control"
              id="password"
              value="aaaaa"
              onChange={doNothing}
            />
          </div>
        </div>
        <div className="row mb-2">
          <div className="col">
            <label htmlFor="name">Name</label>
            <input
              type="text"
              className="form-control"
              id="name"
              onChange={(e) => setName(e.target.value)}
              value={name}
            />
          </div>
          <div className="col">
            <label htmlFor="address">Address</label>
            <input
              type="text"
              className="form-control"
              id="address"
              onChange={(e) => setAddress(e.target.value)}
              value={address}
            />
          </div>
        </div>
        <div className="row mb-3">
          <div className="col">
            <label htmlFor="city">City</label>
            <input
              type="text"
              className="form-control"
              id="city"
              onChange={(e) => setCity(e.target.value)}
              value={city}
            />
          </div>
          <div className="col">
            <label htmlFor="country">country</label>
            {/* <input type="text" className="form-control" id="country" onChange={e => setCountry(e.target.value)} value={country} /> */}
            <CountryDropdown
              className="form-control"
              id="country"
              valueType="short"
              value={country}
              onChange={(val) => setCountry(val)}
            />
          </div>
        </div>
        <div className="row mb-2">
          <div className="col">
            {email !== "" && custExists && (
              <button
                className="btn btn-secondary btn-sm"
                style={{ marginRight: 5 }}
                disabled={true}
                onClick={createCustomer}
              >
                {loading ? (
                  <div
                    className="spinner-border spinner-border-sm"
                    role="status"
                  ></div>
                ) : (
                  "Update Account"
                )}
              </button>
            )}
            {email !== "" && !custExists && (
              <button
                className="btn btn-secondary btn-sm"
                style={{ marginRight: 5 }}
                onClick={createCustomer}
              >
                {loading ? (
                  <div
                    className="spinner-border spinner-border-sm"
                    role="status"
                  ></div>
                ) : (
                  "Create Account"
                )}
              </button>
            )}
            {(email !== "" ||
              name !== "" ||
              address !== "" ||
              city !== "" ||
              country !== "") && (
              <button
                className="btn btn-secondary btn-sm"
                onClick={resetCustomer}
              >
                Reset Form
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
