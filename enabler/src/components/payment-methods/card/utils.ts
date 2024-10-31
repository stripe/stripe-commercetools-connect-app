import styles from '../../../style/style.module.scss';
import inputFieldStyles from '../../../style/inputField.module.scss';

export const fieldIds = {
  cardNumber: 'creditCardForm-cardNumber',
  expiryDate: 'creditCardForm-expiryDate',
  cvv: 'creditCardForm-cvv',
  holderName: 'creditCardForm-holderNameLabel',
};

export const getInput = (field: string) => (document.querySelector(`#${field}`) as HTMLInputElement);

const showErrorIfInvalid = (field: string) => {
  if (!isFieldValid(field)) {
    const input = getInput(field);
    input.parentElement.classList.add(inputFieldStyles.error);
    input.parentElement.querySelector(`#${field} + .${inputFieldStyles.errorField}`).classList.remove(styles.hidden);
  }
}

const hideErrorIfValid = (field: string) => {
  if (isFieldValid(field)) {
    const input = getInput(field);
    input.parentElement.classList.remove(inputFieldStyles.error);
    input.parentElement.querySelector(`#${field} + .${inputFieldStyles.errorField}`).classList.add(styles.hidden);
  }
}

export const validateAllFields = () => {
  let isValid = true;
  Object.values(fieldIds).forEach((field) => {
    if (!isFieldValid(field)) {
      isValid = false;
      showErrorIfInvalid(field);
    }
  });
  return isValid;
}

const handleFieldValidation = (field: string) => {
  const input = getInput(field);
  input.addEventListener('input', () => {
    input.value.length > 0
      ? input.parentElement.classList.add(inputFieldStyles.containValue)
      : input.parentElement.classList.remove(inputFieldStyles.containValue);
    hideErrorIfValid(field);
  });
  input.addEventListener('focusout', () => {
    showErrorIfInvalid(field);
    input.value.length > 0 ? input.parentElement.classList.add(inputFieldStyles.containValue) : input.parentElement.classList.remove(inputFieldStyles.containValue);
  });
}

const isFieldValid = (field: string) => {
  const input = getInput(field);
  switch (field) {
    case 'creditCardForm-cardNumber':
      const cardNumber = getInput(fieldIds.cardNumber);
      const brand = getCardBrand(cardNumber.value);
      if(brand === 'amex') {
        return input.value.replace(/\s/g, '').length === 15;
      } else {
        return input.value.replace(/\s/g, '').length === 16;
      }
    case 'creditCardForm-expiryDate':
      return input.value.length === 5;
    case 'creditCardForm-cvv':
      return input.value.length === 3 || input.value.length === 4;
    case 'creditCardForm-holderNameLabel':
      return input.value.length > 0;
    default:
      return false;
  }
}

export const getCardBrand = (cardNumber: string) => {
  if (cardNumber.startsWith('4')) {
    return 'visa';
  }
  if (cardNumber.startsWith('5')) {
    return 'mastercard';
  }
  if (cardNumber.startsWith('6')) {
    return 'maestro';
  }
  if (cardNumber.startsWith('3')) {
    return 'amex';
  }
  return 'unknown';
}

const dateFormatter = (): ((inputValue: string) => string) => {
  let previousValue = '';
  return (inputValue: string): string => {
    let output = inputValue;
    let isInvalidValue = false;
    const pattern = /[0-9/]/;
    const lastCharacter = inputValue.slice(-1);
    const inputLength = inputValue.length;
    /***
     * should not allow any character other than 0-9 and /
     * should convert eg: 1/ => 01/
     *                eg: 12/3/  =>12/3
     *                eg: 18     =>01/8
     *                eg: 123    =>12/3
     *                eg: 12(previous value = 1)  =>12/
     *                eg: 12(previous value = 12/)  =>1 (delete behaviour)
     *                eg: 12/345 =>12/34
     */
    if (!pattern.test(lastCharacter)) {
      isInvalidValue = true;
    } else if (lastCharacter === '/') {
      if (inputLength === 2) {
        output = `0${inputValue}`;
      } else if (inputLength !== 3) {
        isInvalidValue = true;
      }
    } else if (inputLength === 2) {
      if (previousValue !== `${output}/`) {
        if (Number(inputValue) > 12) {
          output = `0${inputValue[0]}/${inputValue[1]}`;
        } else {
          output = `${output}/`;
        }
      } else {
        output = output[0];
      }
    } else if (inputLength === 3 && lastCharacter != '/') {
      output = `${inputValue[0]}${inputValue[1]}/${inputValue[2]}`;
    } else if (inputLength > 5) {
      isInvalidValue = true;
    }

    if (isInvalidValue) {
      output = inputValue.substring(0, inputLength - 1);
    }
    previousValue = output;
    return output;
  };
};

function formatCardNumberValue(brand: string, cardNumber: HTMLInputElement) {
  let tempVal = cardNumber.value.replace(/\s/g, '');
  let selection = cardNumber.selectionStart;
  if (brand === 'amex') {
    cardNumber.value = (tempVal.slice(0, 4).replace(/(.{4})/g, '$1 ') +
        tempVal.slice(4, 10).replace(/(.{6})/g, '$1 ') +
        tempVal.slice(10, 15)).trim();

    if (cardNumber.value.length === 6 || cardNumber.value.length === 13) {
      selection = selection+1
    }

    cardNumber.selectionStart = selection;
    cardNumber.selectionEnd = selection;
   return cardNumber.value;
  } else {
    if(cardNumber.value.length > 19) {
      cardNumber.value = cardNumber.value.slice(0, 19);
    }
    return cardNumber.value.replace(/(\d{4}(?!\s))/g, "$1 ").trim();
  }
}

const addCardNumberEventListeners = () => {
  const cardNumber = getInput(fieldIds.cardNumber);
  cardNumber.addEventListener('input', () => {
    const brand = getCardBrand(cardNumber.value);
    cardNumber.value = formatCardNumberValue(brand, cardNumber);

    const cardIcons = document.querySelectorAll(`.${styles.cardIcon}`);
    cardIcons.forEach((icon) => {
      icon.classList.add(styles.hidden);
    });
    const cardIcon = document.querySelector(`#creditCardForm-${brand}`);
    if (cardIcon) {
      cardIcon.classList.remove(styles.hidden);
    }
  });
  handleFieldValidation(fieldIds.cardNumber);
}

const addDateEventListeners = () => { 
  const expiryDate = getInput(fieldIds.expiryDate);
  expiryDate.addEventListener('input', () => {
    expiryDate.value = dateFormatter()(expiryDate.value);
  });
  handleFieldValidation(fieldIds.expiryDate);
}

const addCvvEventListeners = () => { 
  const cvv = getInput(fieldIds.cvv);
  cvv.addEventListener('input', () => {
    if (isNaN(Number(cvv.value))) {
      cvv.value = cvv.value.slice(0, -1);
    }
    const cardNumber = getInput(fieldIds.cardNumber);
    const brand = getCardBrand(cardNumber.value);
    if (brand === 'amex') {
      if (cvv.value.length > 4) {
        cvv.value = cvv.value.slice(0, 4);
      }
    } else if (cvv.value.length > 3) {
      cvv.value = cvv.value.slice(0, 3);
    }
  });
  handleFieldValidation(fieldIds.cvv);
}

const addHolderNameEventListeners = () => {
  handleFieldValidation(fieldIds.holderName);
}

export const addFormFieldsEventListeners = () => {
  addCardNumberEventListeners();
  addDateEventListeners();
  addCvvEventListeners();
  addHolderNameEventListeners();
}
