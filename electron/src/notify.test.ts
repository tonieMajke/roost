import { expect, it } from "vitest";
import { notifyArgs } from "./notify";

it("argumenty mają nazwę aplikacji przed tytułem i treścią", () => {
  expect(notifyArgs("Agents: Claude", "skończył pracę w projekt")).toEqual(["-a", "Agents", "Agents: Claude", "skończył pracę w projekt"]);
});
