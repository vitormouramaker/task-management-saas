export function onlyDigits(value: string) {
  return value.replace(/\D/g, "");
}

// CNPJ alfanumérico (Receita, jul/2026): 12 posições [A-Z0-9] + 2 dígitos verificadores.
export function normalizeCnpj(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function formatCpf(value: string) {
  const digits = onlyDigits(value).slice(0, 11);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  if (digits.length <= 9) {
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
  }
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

export function formatCnpj(value: string) {
  const cnpj = normalizeCnpj(value).slice(0, 14);
  if (cnpj.length <= 2) return cnpj;
  if (cnpj.length <= 5) return `${cnpj.slice(0, 2)}.${cnpj.slice(2)}`;
  if (cnpj.length <= 8) {
    return `${cnpj.slice(0, 2)}.${cnpj.slice(2, 5)}.${cnpj.slice(5)}`;
  }
  if (cnpj.length <= 12) {
    return `${cnpj.slice(0, 2)}.${cnpj.slice(2, 5)}.${cnpj.slice(5, 8)}/${cnpj.slice(8)}`;
  }
  return `${cnpj.slice(0, 2)}.${cnpj.slice(2, 5)}.${cnpj.slice(5, 8)}/${cnpj.slice(8, 12)}-${cnpj.slice(12)}`;
}

export function formatPhone(value: string) {
  const digits = onlyDigits(value).slice(0, 11);
  if (digits.length < 3) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

export function formatIsoDate(value: string | null | undefined) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? "");
  return match ? `${match[3]}/${match[2]}/${match[1]}` : "";
}

export function isValidCpf(value: string) {
  const cpf = onlyDigits(value);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;

  const digits = cpf.split("").map(Number);
  const checkDigit = (length: number) => {
    let sum = 0;
    for (let index = 0; index < length; index += 1) {
      sum += digits[index] * (length + 1 - index);
    }
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };

  return checkDigit(9) === digits[9] && checkDigit(10) === digits[10];
}

export function isValidCnpj(value: string) {
  const cnpj = normalizeCnpj(value);
  if (!/^[A-Z0-9]{12}\d{2}$/.test(cnpj) || /^(.)\1{13}$/.test(cnpj)) return false;

  const checkDigit = (length: number) => {
    const weights =
      length === 12
        ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let sum = 0;
    for (let index = 0; index < length; index += 1) {
      sum += (cnpj.charCodeAt(index) - 48) * weights[index];
    }
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };

  return (
    checkDigit(12) === Number(cnpj[12]) && checkDigit(13) === Number(cnpj[13])
  );
}

export function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/** Data máxima de nascimento para o titular ter 18 anos (formato do input date). */
export function getAdultBirthDateLimit() {
  const today = new Date();
  const limit = new Date(
    today.getFullYear() - 18,
    today.getMonth(),
    today.getDate(),
  );
  const month = String(limit.getMonth() + 1).padStart(2, "0");
  const day = String(limit.getDate()).padStart(2, "0");
  return `${limit.getFullYear()}-${month}-${day}`;
}
