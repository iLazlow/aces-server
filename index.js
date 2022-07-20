const moment = require('moment');
const sqlite3 = require('sqlite3')
const { PORT } = require('./config.json');
const fs = require('fs');
const DAO = require('./dao');
const express = require('express');
const bodyParser = require('body-parser');

const app = express();
const dao = new DAO('./main.db');
const wss = require('express-ws')(app);

app.use(bodyParser.json({limit: '1mb'}));
app.use(bodyParser.urlencoded({
  extended: true,
  limit: '1mb'
}));
app.use(function (req, res, next) {
  //console.log('middleware');
  //req.testing = 'testing';
  return next();
});

app.ws('/', function(ws, req) {
  ws.publicKey = req.query.pub;
  
  dao.all("SELECT * FROM message_queue WHERE recipient = ? ORDER BY created ASC", [ws.publicKey]).then(result => {
    if(result.length > 0){
      console.log("found messages for " + ws.publicKey);
      result.forEach(function(msg) {
        console.log("send msg " + msg.id);
        ws.send(JSON.stringify({type: "message", msg: msg.content, created: msg.created}));
        dao.run('DELETE FROM message_queue WHERE id = ?', [msg.id]);
      });
    }
  });


  ws.on('message', function message(data) {
    const json = JSON.parse(data);

    if(json.type == "msg"){
      console.log(`send message from ${json.sender} to ${json.recipient}`);
      var i = 0;
      wss.getWss().clients.forEach(function(client) {
        if(client.publicKey == json.recipient){
          client.send(JSON.stringify({type: "message", msg: json.content, created: moment(new Date()).format('YYYY-MM-DD HH:mm:ss')}));
          i++;
        }
      });
      if(i == 0){
        console.log("no client found. save in database for later");
        dao.run('INSERT INTO message_queue (sender, recipient, content, created) VALUES (?, ?, ?, ?)', [json.sender, json.recipient, json.content, moment(new Date()).format('YYYY-MM-DD HH:mm:ss')]);
        //TODO: implement notifications
      }
    }else{
      ws.send(JSON.stringify({type: "error", msg: "Unknown action"}));
    }
  });

  ws.send(JSON.stringify({type: "connected", key: ws.publicKey}));
});

/* Server Endpoints */
app.get("/", (req, res) => res.send("Aces Server is working!"));

app.post('/checkin', (req, res) => {
  dao.get("SELECT * FROM accounts WHERE username LIKE '%" + req.body.username + "%'").then(result => {
    console.log(result);
    if(result == undefined){
      res.send({status: "success", type: "CREATED", message: "Account with username " + req.body.username + " created"});
      dao.run('INSERT INTO accounts (username, password, created, key) VALUES (?, ?, ?, ?)', [req.body.username, req.body.password, moment(new Date()).format('YYYY-MM-DD HH:mm:ss'), req.body.public]);
    }else{
      if(result.password == req.body.password){
        res.send({status: "success", type: "LOGIN", message: "Account with username " + req.body.username + " found"});
        dao.run('UPDATE accounts SET key = ? WHERE id = ?', [req.body.public, result.id]);
      }else{
        res.send({status: "error", type: "WRONG_CREDENTIALS", message: "Your username or password is invalid"});
      }
    }
  });
});

app.post('/check', (req, res) => {
  res.send({status: "success", type: "CHECK", message: "Webserver check was successfully executed"});
});

app.get('/check', (req, res) => {
  res.send({status: "success", type: "CHECK", message: "Webserver check was successfully executed"});
});

app.listen(PORT, () => console.log(`Aces Server listening on port ${PORT}!`));