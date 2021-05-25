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

let loginSession;
// Stores all slots discovered here so that same slot wont be notified everytime the bot checks
let slotHistory = {};

const app = express();
const PORT = process.env.PORT || 1234;

main = async () => {
  scheduleJob();
};

scheduleJob = () => {
  // Check for auto book
  cron.schedule("0,5,10,15,20,25,30,35,40,45,50,55 * * * *", async () => {
    console.log("Doing a job.");
    const [cookie] = await getCookie();
    [loginSession] = cookie.split(";");
    await login();
    const slots = await getSlots(populatePreference());
    sendPrettifiedSlotsMessage(slots);
    slotHistory = {
      ...slots,
      ...slotHistory,
    };
    console.log("Attempting to book slots...");
    autoBook(slots);
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
        console.log(
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
    MONTH: ["May/2021", "Jun/2021"],
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

createBooking = async (slotID) => {
  console.log("Slot booking started, slot ID is:" + slotID.slotID);
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
      console.log("Booking confirmed!");
    }
  } catch (error) {
    console.error(error);
  }
};

sendPrettifiedSlotsMessage = async (data) => {
  if (Object.keys(data).length === 0) {
    console.log("Unable to find any slots");
    return;
  }

  let message = "";
  for (slot in data) {
    message = message + "🚗 " + data[slot].info + "\n";
  }
  console.log(message);
};

deleteMessage = (messageID) => {
  console.log(messageID);
};

app.get("/", (req, res) => res.send("Hello World!"));

app.listen(PORT, () => console.log(`BBDC bot listening on port:${PORT}`));

main();
