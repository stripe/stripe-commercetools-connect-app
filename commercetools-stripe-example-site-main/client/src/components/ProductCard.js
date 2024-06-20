import React, { useState } from "react";
import Carousel from "./Carousel";
import Modal from "react-bootstrap/Modal";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faTimes } from "@fortawesome/free-solid-svg-icons";
import getSymbolFromCurrency from "currency-symbol-map";

export default function ProductCard(props) {
  const [show, setShow] = useState(false);
  const handleClose = () => setShow(false);
  const handleShow = () => setShow(true);

  const styles = {
    price: {
      fontSize: "larger",
      fontWeight: 600,
      display: "block",
    },
    card: {
      borderRadius: 5,
      boxShadow: "silver 0px 0px 6px 0px",
      cursor: "pointer",
      border: "1px solid silver",
    },
    name: {
      fontSize: "1.1em",
      fontWeight: 500,
    },
    nameModal: {
      fontSize: "1.5em",
      fontWeight: 500,
    },
    img: {
      maxHeight: 500,
      objectFit: "cover",
      marginLeft: "auto",
      marginRight: "auto",
      borderRadius: "5px 5px 0 0",
    },
  };

  const addToCart = (e) => {
    props.addToCart(props.product);
    setShow(false);
  };

  const getMetadata = (metadata, type) => {
    const output = [];
    if (Object.keys(metadata).indexOf(type + "1") > -1) {
      output.push(
        Object.entries(metadata).map(([key, value]) => {
          if (key.indexOf(type) !== -1) {
            return type === "Features" ? (
              <li key={key}>{value}</li>
            ) : (
              <p key={key}>{value}</p>
            );
          }
          return "";
        })
      );
      if (type === "Features") output.push(<br key={"spacer" + type} />);
    }
    return output;
  };

  const displayPrice = (value) => {
    if (!value) {
      return `${getSymbolFromCurrency(props.currency)} 100`;
    }
    return `${getSymbolFromCurrency(props.currency)} ${(
      value.centAmount / 100
    ).toFixed(value.fractionDigits)}`;
  };

  return (
    <>
      <div className="col">
        <div style={styles.card} className="h-100" onClick={handleShow}>
          <img
            alt="product"
            src={props.product.masterData.current.masterVariant.images[0]?.url}
            className="w-100"
            style={styles.img}
          />
          <div className="card-body" style={{ paddingBottom: 0 }}>
            <h5 style={styles.name}>
              {props.product.masterData.current.name["en-US"]}
            </h5>
            {/* <p style={{ paddingTop: '20px' }}>{props.product.description}</p> */}
            <p>
              {displayPrice(
                props.product.masterData.current.masterVariant.prices[0]?.value
              )}
            </p>
          </div>
        </div>
      </div>
      <Modal show={show} centered onHide={handleClose} size="lg">
        <Modal.Header style={styles.nameModal}>
          {props.product.masterData.current.name["en-US"]}
          <FontAwesomeIcon
            icon={faTimes}
            style={{ cursor: "pointer" }}
            onClick={handleClose}
          />
        </Modal.Header>
        <Modal.Body>
          <div className="row">
            <div className="col-5">
              <Carousel
                id={"modal_" + props.product.id}
                images={[
                  props.product.masterData.current.masterVariant.images[0]?.url,
                ]}
              />
            </div>
            <div className="col-5">
              <p>{props.product.masterData.current.description["en-US"]}</p>
            </div>
          </div>
        </Modal.Body>
        <Modal.Footer>
          <button
            className="btn"
            style={{ backgroundColor: props.brandColor, color: "blue" }}
            id={props.product.id}
            onClick={addToCart}
          >
            Add to Cart
          </button>
        </Modal.Footer>
      </Modal>
    </>
  );
}
