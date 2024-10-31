import {
  ComponentOptions,
  PaymentComponent,
  PaymentComponentBuilder,
  PaymentMethod,
} from "../../../payment-enabler/payment-enabler";
import { BaseComponent } from "../../base";
import inputFieldStyles from "../../../style/inputField.module.scss";
import styles from "../../../style/style.module.scss";
import buttonStyles from "../../../style/button.module.scss";
import {
  PaymentOutcome,
  PaymentRequestSchemaDTO,
} from "../../../dtos/mock-payment.dto";
import { BaseOptions } from "../../../payment-enabler/payment-enabler-mock";

export class PurchaseOrderBuilder implements PaymentComponentBuilder {
  public componentHasSubmit = true;
  constructor(private baseOptions: BaseOptions) {}

  build(config: ComponentOptions): PaymentComponent {
    return new PurchaseOrder(this.baseOptions, config);
  }
}

export class PurchaseOrder extends BaseComponent {
  private showPayButton: boolean;
  private poNumberId = "purchaseOrderForm-poNumber";
  private invoiceMemoId = "purchaseOrderForm-invoiceMemo";

  constructor(baseOptions: BaseOptions, componentOptions: ComponentOptions) {
    super(PaymentMethod.purchaseorder, baseOptions, componentOptions);
    this.showPayButton = componentOptions?.showPayButton ?? false;
  }

  mount(selector: string) {
    document
      .querySelector(selector)
      .insertAdjacentHTML("afterbegin", this._getTemplate());

    if (this.showPayButton) {
      document
        .querySelector("#purchaseOrderForm-paymentButton")
        .addEventListener("click", (e) => {
          e.preventDefault();
          this.submit();
        });
    }

    this.addFormFieldsEventListeners();
  }

  async submit() {
    // here we would call the SDK to submit the payment
    this.sdk.init({ environment: this.environment });

    const isFormValid = this.validateAllFields();
    if (!isFormValid) {
      return;
    }

    try {
      const requestData: PaymentRequestSchemaDTO = {
        paymentMethod: {
          type: this.paymentMethod,
          poNumber: this.getInput(this.poNumberId).value.trim(),
          invoiceMemo: this.getInput(this.invoiceMemoId).value.trim(),
        },
        paymentOutcome: PaymentOutcome.AUTHORIZED,
      };

      const response = await fetch(this.processorUrl + "/payments", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Session-Id": this.sessionId,
        },
        body: JSON.stringify(requestData),
      });
      const data = await response.json();
      if (data.paymentReference) {
        this.onComplete &&
          this.onComplete({
            isSuccess: true,
            paymentReference: data.paymentReference,
          });
      } else {
        this.onError("Some error occurred. Please try again.");
      }
    } catch (e) {
      this.onError("Some error occurred. Please try again.");
    }
  }

  showValidation() {
    this.validateAllFields();
  }

  isValid() {
    return this.validateAllFields();
  }

  private _getTemplate() {
    const payButton = this.showPayButton
      ? `<button class="${buttonStyles.button} ${buttonStyles.fullWidth} ${styles.submitButton}" id="purchaseOrderForm-paymentButton">Pay</button>`
      : "";
    return `
    <div class="${styles.wrapper}">
      <form class="${styles.paymentForm}">
        <div class="${inputFieldStyles.inputContainer}">
          <label class="${inputFieldStyles.inputLabel}" for="purchaseOrderForm-poNumber">
            PO Number <span aria-hidden="true"> *</span>
          </label>
          <input class="${inputFieldStyles.inputField}" type="text" id="purchaseOrderForm-poNumber" name="poNumber" value="">
          <span class="${styles.hidden} ${inputFieldStyles.errorField}">Invalid PO number</span>
        </div>
        <div class="${inputFieldStyles.inputContainer}">
          <label class="${inputFieldStyles.inputLabel}" for="purchaseOrderForm-invoiceMemo">
            Invoice memo
          </label>
          <input class="${inputFieldStyles.inputField}" type="text" id="purchaseOrderForm-invoiceMemo" name="invoiceMemo" value="">
          <span class="${styles.hidden} ${inputFieldStyles.errorField}">Invalid Invoice memo</span>
        </div>
        ${payButton}
      </form>
      </div>
    `;
  }

  private addFormFieldsEventListeners = () => {
    this.handleFieldValidation(this.poNumberId);
    this.handleFieldFocusOut(this.invoiceMemoId);
  };

  private getInput(field: string): HTMLInputElement {
    return document.querySelector(`#${field}`) as HTMLInputElement;
  }

  private validateAllFields(): boolean {
    let isValid = true;
    if (!this.isFieldValid(this.poNumberId)) {
      isValid = false;
      this.showErrorIfInvalid(this.poNumberId);
    }

    return isValid;
  }

  private isFieldValid(field: string): boolean {
    const input = this.getInput(field);
    return input.value.replace(/\s/g, "").length > 0;
  }

  private showErrorIfInvalid(field: string) {
    if (!this.isFieldValid(field)) {
      const input = this.getInput(field);
      input.parentElement.classList.add(inputFieldStyles.error);
      input.parentElement
        .querySelector(`#${field} + .${inputFieldStyles.errorField}`)
        .classList.remove(styles.hidden);
    }
  }

  private hideErrorIfValid = (field: string) => {
    if (this.isFieldValid(field)) {
      const input = this.getInput(field);
      input.parentElement.classList.remove(inputFieldStyles.error);
      input.parentElement
        .querySelector(`#${field} + .${inputFieldStyles.errorField}`)
        .classList.add(styles.hidden);
    }
  };

  private handleFieldValidation(field: string) {
    const input = this.getInput(field);
    input.addEventListener("input", () => {
      this.manageLabelClass(input);
      this.hideErrorIfValid(field);
    });
    input.addEventListener("focusout", () => {
      this.showErrorIfInvalid(field);
      this.manageLabelClass(input);
    });
  }

  private handleFieldFocusOut(field: string) {
    const input = this.getInput(field);
    input.addEventListener("focusout", () => {
      this.manageLabelClass(input);
    });
  }

  private manageLabelClass = (input: HTMLInputElement) => {
    input.value.length > 0
      ? input.parentElement.classList.add(inputFieldStyles.containValue)
      : input.parentElement.classList.remove(inputFieldStyles.containValue);
  };
}
