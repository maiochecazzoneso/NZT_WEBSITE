// frontend/ui/src/index.ts — entry point di @nzt/ui (consumato da sorgente, nessun build step).
// Ordine degli export = ordine di valutazione dei moduli: Button per primo mantiene il bundle della
// landing identico byte per byte a quello precedente all'estrazione (cva prima di clsx/tailwind-merge).
export { Button, buttonVariants, type ButtonProps } from './Button';
export { Card } from './Card';
export { Badge, type BadgeProps } from './Badge';
export { Input, type InputProps } from './Input';
export { Field, type FieldProps, type FieldControlProps } from './Field';
export { Alert, type AlertProps } from './Alert';
export { cn } from './cn';
