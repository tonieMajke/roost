import { expect, it } from "vitest";
import { notifyArgs } from "./notify";

it("argumenty mają nazwę aplikacji przed tytułem i treścią", () => {
  expect(notifyArgs("Roost: Claude", "skończył pracę w projekt")).toEqual(["-a", "Roost", "Roost: Claude", "skończył pracę w projekt"]);
});

it("z kliknięciem: akcja `default` przed tytułem", () => {
  expect(notifyArgs("Rusty: Newsy", "Spokojna doba.", true)).toEqual(["-a", "Roost", "-A", "default=Otwórz", "Rusty: Newsy", "Spokojna doba."]);
});
