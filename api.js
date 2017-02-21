#!/usr/bin/node

// *********** OBJECT INITIALIZATION ************
var fs = require('fs');
var opts = {
  key: fs.readFileSync("/home/master/certs/key.pem"),
  cert: fs.readFileSync("/home/master/certs/cert.pem")
};
var Canvas = require('canvas');
var Image = Canvas.Image;
var app = require('express')();
var https = require('https').createServer(opts,app);
var redirApp = require('express')();
var redirHttp = require('http').createServer(redirApp);
var mysql = require('mysql');
var parkingDb = mysql.createConnection({
  host: 'localhost',
  user: 'nobody',
  database: 'parking',
  password: ''
});
var parser = require('body-parser');
var spots = {};
var lots = {};
var img = new Image;
var maskToSpot = {};
var secretKey = "welcome";

// ********* SETUP *********
https.listen(8080, function(){
  console.log('Server started. Listening on port 8080');
});


// Redirect all traffic to https@8080
redirHttp.listen(80);
redirApp.get('*',function(req,res){
  res.redirect('https://www.tfletch.tech:8080'+req.url);
});

app.use(parser.json());

parkingDb.connect(function(err){
  if(err){
    console.log("Error connecting to MySQL")
    return;
  }
  console.log("MySQL connection established");
});

// Update spots
setInterval(function(){
  parkingDb.query("SELECT * FROM spots", function(err,rows){
    var newSpot = {}
    rows.forEach(function(spot){
      newSpot[spot.spot_id] = spot;
    });
    spots = newSpot;
  });
}, 1000)

// Update lots
setInterval(function(){
  parkingDb.query("SELECT l.lot_id, l.latitude lat, l.longitude lng, l.name, SUM(s.empty) freeSpots, COUNT(s.spot_id) totalSpots FROM lots l INNER JOIN spots s ON s.lot_id = l.lot_id GROUP BY l.lot_id", function(err,rows){
    var newLots = {}
    rows.forEach(function(lot){
      newLots[lot.lot_id] = lot;
    });
    lots = newLots;
  });
}, 1000)

// Update lotmap
setInterval(function(){
  Object.keys(spots).forEach(function(key){
    val = spots[key];
    var hex = ("00000"+parseInt(key).toString(16)).slice(-6);
    maskToSpot[hex] = val.empty;
  });
  Object.keys(lots).forEach(function(lotId){
    var out = fs.createWriteStream(__dirname + '/lotmap/lot'+lotId+'.png');
    fs.readFile(__dirname + '/lotmask/lot'+lotId+'.png', function(err, lotImg){
      if (err) throw err;
      
      img.src = lotImg;
      var maskCanvas = new Canvas(img.width,img.height);
      var mask = maskCanvas.getContext('2d');
      mask.drawImage(img, 0, 0);
      
      var maskImageData = mask.getImageData(0,0,maskCanvas.width,maskCanvas.height);
      var maskData = maskImageData.data;
      for(var i = 0; i < maskData.length; i+=4){ 
        var r = (maskData[i] < 15 ? "0" : "") + maskData[i].toString(16);
        var g = (maskData[i+1] < 15 ? "0" : "") + maskData[i+1].toString(16);
        var b = (maskData[i+2] < 15 ? "0" : "") + maskData[i+2].toString(16);
        var hex = r+g+b;
        if(hex === "000000" ||  hex === "ffffff"){
          continue;
        }
        if(maskToSpot[hex]){
          maskData[i] = 0; 
          maskData[i+1] = 255;
          maskData[i+3] = 255;
        }else{
          maskData[i] = 255;
          maskData[i+1] = 0; 
          maskData[i+3] = 255;
        }
      }
      maskImageData.data = maskData;
      mask.putImageData(maskImageData,0,0);
      var stream = maskCanvas.pngStream();
      stream.on('data',function(chunk){
        out.write(chunk);
      });
    });
  });
},2000);
// ********** API CALLS ***************
app.get('/getSpots', function(req,res){
  res.json(spots);
});

app.get('/getSpot', function(req,res){
  if(req.query.spot_id == undefined){
    res.status(400);
    res.end();
    return;
  } 
  res.json(spots[req.query.spot_id]);
});

app.get('/getLots', function(req,res){
  console.log(lots);
  res.json(lots);
});

app.get('/getLot', function(req,res){
  if(req.query.lot_id == undefined){
    res.status(400);
    res.end();
    return;
  } 
  res.json(lots[req.query.lot_id]);
});

app.get('/getLotMap', function(req,res){
  if(req.query.lot_id == undefined){
    res.status(400);
    res.end();
    return;
  }
  res.sendFile(__dirname + '/lotmask/lot'+req.query.lot_id+'.png');
});

app.get('/',function(req,res){
  res.sendFile(__dirname+"/map.html");
});

app.get('/lot', function(req,res){
  if(req.query.lot_id == undefined){
    res.status(400);
    res.end();
    return;
  }
  res.sendFile(__dirname + '/lotmap/lot'+req.query.lot_id+'.png');
});

app.post('/updateSpots', function(req,res){
  if(req.body.secretKey != secretKey){
    res.status(403);
    res.end();
    return;
  } 
  if(req.body.spot_id == undefined || req.body.empty == undefined){
    res.status(400);
    res.end();
    return;
  }
  parkingDb.query("UPDATE spots SET empty = ? WHERE spot_id = ?", 
    [req.body.empty,req.body.spot_id]);
  res.status(200);
  res.end();
});
