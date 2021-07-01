/* PROCESS ENV VARIABLES:
TELEGRAM TOKEN
TELEGRAM_CHAT_ID
NRIC
BBDC_PASSWORD
ACCID

*/

require("dotenv").config();
const express = require("express");
const axios = require("axios");
const qs = require("querystring");
const cheerio = require("cheerio");
const cron = require("node-cron");
const moment = require("moment-timezone");
const BBDC_URL = "http://www.bbdc.sg/bbdc/bbdc_web/newheader.asp";
const BBDC_LOGIN_URL = "http://www.bbdc.sg/bbdc/bbdc_web/header2.asp";
const BBDC_SLOTS_LISTING_URL =
  "http://www.bbdc.sg/bbdc/b-3c-pLessonBooking1.asp";
const BBDC_BOOKING_URL =
  "http://www.bbdc.sg/bbdc/b-3c-pLessonBookingDetails.asp";
const BBDC_TPDS_SELECT_URL = "http://www.bbdc.sg/bbdc/b-selectTPDSModule.asp";
const BBDC_TPDS_SLOTS_URL = "http://www.bbdc.sg/bbdc/b-TPDSBooking1.asp";
const Telegram = require("telegraf/telegram");
const telegram = new Telegram(process.env.TELEGRAM_TOKEN);
let loginSession;
// Stores all slots discovered here so that same slot wont be notified everytime the bot checks
let slotHistory = {};

const app = express();
const PORT = process.env.PORT || 8000;

main = async () => {
  telegram.sendMessage(process.env.TELEGRAM_CHAT_ID, `BBDC Bot started.`, {
    parse_mode: "HTML",
  });
  scheduleJobTP();
};

scheduleJob = () => {
  // Check for auto book
  cron.schedule("*/2 * * * *", async () => {
    console.log("Doing a job.");
    telegram.sendMessage(process.env.TELEGRAM_CHAT_ID, "Looking for a slot...");
    const [cookie] = await getCookie();
    [loginSession] = cookie.split(";");
    await login();
    const slots = await getSlots(populatePreference());
    sendPrettifiedSlotsMessage(slots);
    slotHistory = {
      ...slots,
      ...slotHistory,
    };
    autoBook(slots);
  });
};

scheduleJobTP = () => {
  cron.schedule("*/2 * * * *", async () => {
    console.log("Doing a job (TPDS).");
    telegram.sendMessage(
      process.env.TELEGRAM_CHAT_ID,
      "Looking for a TPDS slot..."
    );
    const [cookie] = await getCookie();
    [loginSession] = cookie.split(";");
    await login();
    await selectModuleTP(2);
    await timeout(10000);
    const slots = await getSlotsTP(populatePreferenceTP());
    sendPrettifiedSlotsMessage(slots);
    // slotHistory = {
    //   ...slots,
    //   ...slotHistory,
    // };
    // autoBook(slots);
  });
};

getCookie = async () => {
  try {
    const response = await axios.get(BBDC_URL);
    return response.headers["set-cookie"];
  } catch (error) {
    console.error(error);
  }
};

login = async () => {
  console.log("Starting log in");
  try {
    const data = {
      txtNRIC: process.env.NRIC,
      txtPassword: process.env.BBDC_PASSWORD,
      btnLogin: "ACCESS+TO+BOOKING+SYSTEM",
      ca: "true",
    };
    const config = {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: loginSession,
      },
    };
    await axios.post(BBDC_LOGIN_URL, qs.stringify(data), config);
  } catch (error) {
    console.error(error);
  }
};

getSlots = async (preference) => {
  console.log("Checking slots");

  try {
    const config = {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: loginSession,
      },
    };
    const response = await axios.post(
      BBDC_SLOTS_LISTING_URL,
      qs.stringify(preference),
      config
    );
    return parseSlotsListing(response.data);
  } catch (error) {
    console.error(error);
  }
};

timeout = (ms) => {
  return new Promise((res) => setTimeout(res, ms));
};

selectModuleTP = async (n) => {
  const config = {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: loginSession,
    },
  };
  const response = await axios.post(
    BBDC_TPDS_SELECT_URL,
    qs.stringify({
      optTest: n,
      btnSubmit: "Submit",
    }),
    config
  );
  console.log(response.data);
};

getSlotsTP = async (preference) => {
  console.log("Checking slots");

  try {
    const config = {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: loginSession,
      },
    };
    const response = await axios.post(
      BBDC_TPDS_SLOTS_URL,
      qs.stringify(preference),
      config
    );
    console.log(response);
    return parseSlotsListing(response.data);
  } catch (error) {
    console.error(error);
  }
};

autoBook = async (slots) => {
  const today = moment.tz("Asia/Singapore");
  let count = 0;
  for (slot in slots) {
    if (count === 0) {
      const dateStr = slots[slot]["date"].split(" ");
      const date = moment(dateStr[0], "D/M/YYYY");
      console.log(slots[slot]);
      console.log("Diff in date: " + date.diff(today, "days"));
      if (date.diff(today, "days") >= 2) {
        createBooking(slots[slot]);
        telegram.sendMessage(
          process.env.TELEGRAM_CHAT_ID,
          "Booking slot for " +
            slots[slot]["date"] +
            ". From " +
            slots[slot]["start"] +
            " to " +
            slots[slot]["end"] +
            ". Please verify booking"
        );
      }
      count += 1;
    }
  }
};

populatePreference = () => {
  const data = {
    accid: process.env.ACCID,
    optVenue: "1",
    defPLVenue: "1",
    DAY: [1, 2, 3, 4, 5, 6, 7],
    SESSION: [1, 2, 3, 4, 5, 6, 7, 8],
    MONTH: ["Jul/2021", "Aug/2021"],
  };

  return data;
};

populatePreferenceTP = () => {
  const data = {
    accid: process.env.ACCID,
    MONTH: ["Jul/2021", "Aug/2021"],
    SESSION: [1],
    DAY: [1, 2, 3, 4, 5, 6, 7],
    defPEVenue: "1",
    optVenue: "1",
  };

  return data;
};

parseSlotsListing = (data) => {
  let re = /"(.*?)"/g;
  let slots = {};
  const $ = cheerio.load(data);
  $(
    "#myform > table:nth-child(2) > tbody > tr:nth-child(10) > td > table > tbody > tr > td[onmouseover]"
  ).each(function (i, elem) {
    let slotInfo = $(this).attr("onmouseover").matchAll(re);
    slotInfo = Array.from(slotInfo);
    const slotID = $(this).children().attr("value");
    const date = slotInfo[0][1];
    const session = slotInfo[1][1];
    const start = slotInfo[2][1];
    const end = slotInfo[3][1];

    if (!(slotID in slotHistory)) {
      let informationStr = `New slot found on ${date}, Session: ${session} (${start} - ${end})`;
      slots[slotID] = {
        info: informationStr,
        date: date,
        start: start,
        end: end,
        session: session,
        slotID: slotID,
      };
    }
  });

  return slots;
};

parseSlotsListingTP = (data) => {
  let re = /"(.*?)"/g;
  let slots = {};
  const $ = cheerio.load(data);
  $(
    "#myform > table:nth-child(2) > tbody > tr:nth-child(10) > td > table > tbody > tr > td[onmouseover]"
  ).each(function (i, elem) {
    let slotInfo = $(this).attr("onmouseover").matchAll(re);
    slotInfo = Array.from(slotInfo);
    const slotID = $(this).children().attr("value");
    const date = slotInfo[0][1];
    const session = slotInfo[1][1];
    const start = slotInfo[2][1];
    const end = slotInfo[3][1];

    if (!(slotID in slotHistory)) {
      let informationStr = `New slot found on ${date}, Session: ${session} (${start} - ${end})`;
      slots[slotID] = {
        info: informationStr,
        date: date,
        start: start,
        end: end,
        session: session,
        slotID: slotID,
      };
    }
  });

  return slots;
};

createBooking = async (slotID) => {
  telegram.sendMessage(
    process.env.TELEGRAM_CHAT_ID,
    "Slot booking started, slot ID is:" + slotID.slotID
  );
  try {
    const data = {
      accId: process.env.ACCID,
      slot: slotID.slotID,
    };
    const config = {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: loginSession,
      },
    };
    const response = await axios.post(
      BBDC_BOOKING_URL,
      qs.stringify(data),
      config
    );
    const emsg = cheerio.load(response.data);
    let errorMessage = emsg(
      "body > table > tbody > tr > td:nth-child(2) > form > table > tbody > tr:nth-child(1) > td > table > tbody > tr:nth-child(3) > td.errtblmsg"
    );
    if (errorMessage.is(".errtblmsg")) {
      telegram.sendMessage(process.env.TELEGRAM_CHAT_ID, errorMessage.text());
    }
  } catch (error) {
    console.error(error);
  }
};

sendPrettifiedSlotsMessage = async (data) => {
  if (Object.keys(data).length === 0) {
    telegram.sendMessage(process.env.TELEGRAM_CHAT_ID, "No Slots Found");
    return;
  }

  let message = "";
  for (slot in data) {
    if (message.length <= 70)
      message = message + "🚗 " + data[slot].info + "\n";
  }
  telegram.sendMessage(process.env.TELEGRAM_CHAT_ID, message);
};

app.get("/", (req, res) => res.send("Hello World!"));

app.listen(PORT, () => console.log(`BBDC bot listening on port:${PORT}`));

main();
