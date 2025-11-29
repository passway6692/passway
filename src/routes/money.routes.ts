import { Router } from "express";
import { sendMoney ,getUserTransactions,getUserBalance, withdrawMoney,getWithdraws} from "../controllers/money.controller";

const route = Router();

route.post("/send", sendMoney);
route.get("/my-transactions", getUserTransactions);
route.get("/balance", getUserBalance);
route.post("/withdraw", withdrawMoney);
route.get("/withdraws", getWithdraws);
export default route;
