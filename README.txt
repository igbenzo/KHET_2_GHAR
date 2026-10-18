KHET2GHAR - Agricultural Marketplace (saves to Excel)
======================================================

RUN (Windows): double-click start.bat
   or in Command Prompt:   npm install   (first time only)   then   npm start
Open http://localhost:3000

All records are saved in:  C:\Users\<your name>\Khet2Ghar-data\marketplace.xlsx
(outside the project folder, so a new version of the code never erases your records)
Sheets: Farmers, Buyers, Crops, Orders. The file is created automatically.
Close the file in Excel before registering/ordering, or saving will fail.

TESTER ACCOUNT
   Username MARCOS (works as both farmer and buyer). Remove TESTER in server.js before going live.
   Passwords are saved as a salted hash, not readable text.

OPTIONAL: GOOGLE SHEETS INSTEAD OF EXCEL
   Set "storage": "google" in config.json and follow the steps inside google-apps-script/Code.gs
   (paste it into Extensions > Apps Script, deploy as Web app with access "Anyone",
   then put the URL and secret into config.json).

Needs Node.js 18 or newer.
