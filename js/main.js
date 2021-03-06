var App = require('./App'),
    app = new App();

var __ = window.__ = require('underscore'),
    Backbone = require('backbone'),
    $ = require('jquery');
Backbone.$ = $;
//add to global scope for non-modular libraries
window.Backbone = Backbone;
window.$ = $;
window.jQuery = $;
window.Backbone.$ = $;
window.focused = true;

// we need to know this for notifications
window.onfocus = function() {
  window.focused = true;
};

window.onblur = function() {
  window.focused = false;
};

var Polyglot = require('node-polyglot'),
    getBTPrice = require('./utils/getBitcoinPrice'),
    router = require('./router'),
    userModel = require('./models/userMd'),
    userProfileModel = require('./models/userProfileMd'),
    languagesModel = require('./models/languagesMd'),
    mouseWheel = require('jquery-mousewheel'),
    mCustomScrollbar = require('./utils/jquery.mCustomScrollbar.js'),
    setTheme = require('./utils/setTheme.js'),
    pageNavView = require('./views/pageNavVw'),
    ChatVw = require('./views/chatVw'),
    user = new userModel(),
    userProfile = new userProfileModel(),
    languages = new languagesModel(),
    socketView = require('./views/socketVw'),
    cCode = "",
    $loadingModal = $('.js-loadingModal'),
    ServerConnectModal = require('./views/serverConnectModal'),
    OnboardingModal = require('./views/onboardingModal'),
    serverConfigMd = app.serverConfig,
    heartbeat = app.getHeartbeatSocket(),
    loadProfileNeeded = true,
    startUpConnectMaxRetries = 2,
    startUpConnectRetryDelay = 2 * 1000,
    startUpConnectMaxTime = 6 * 1000,
    startTime = Date.now(),
    extendPolyglot,
    newPageNavView,
    newSocketView,
    serverConnectModal,
    onboardingModal,
    startInitSequence,
    startLocalInitSequence,
    startRemoteInitSequence,
    launchOnboarding,
    launchServerConnect,
    setServerUrl,
    guidCreating,
    after401LoginRequest;

//put language in the window so all templates and models can reach it. It's especially important in formatting currency.
window.lang = user.get("language");

//put polyglot in the window so all templates can reach it
window.polyglot = new Polyglot({locale: window.lang});

(extendPolyglot = function(lang) {
  window.polyglot.extend(__.where(languages.get('languages'), {langCode: window.lang})[0]);
})(window.lang);

user.on('change:language', function(md, lang) {
  window.lang = lang;
  extendPolyglot(lang);
});

//keep user and profile urls synced with the server configuration
(setServerUrl = function() {
  var baseServerUrl = serverConfigMd.getServerBaseUrl();
  
  user.urlRoot = baseServerUrl + "/settings";
  user.set('serverUrl', baseServerUrl + '/');
  userProfile.urlRoot = baseServerUrl + "/profile";
})();

serverConfigMd.on('sync', function(md) {
  setServerUrl();
});

//put the event bus into the window so it's available everywhere
window.obEventBus =  __.extend({}, Backbone.Events);

// fix zoom issue on Linux hiDPI
var platform = process.platform;

if(platform === "linux") {
  var scaleFactor = require('screen').getPrimaryDisplay().scaleFactor;
  if (scaleFactor === 0) {
      scaleFactor = 1;
  }
  $("body").css("zoom", 1 / scaleFactor);
}

//open external links in a browser, not the app
$('body').on('click', '.js-externalLink, .js-externalLinks a, .js-listingDescription a', function(e){
  e.preventDefault();
  var extUrl = $(this).attr('href');
  if (!/^https?:\/\//i.test(extUrl)) {
    extUrl = 'http://' + extUrl;
  }
  require("shell").openExternal(extUrl);
});

//record changes to the app state
$(window).bind('hashchange', function(){
  "use strict";
  localStorage.setItem('route', Backbone.history.getFragment());
});

//set fancy styles class
if(localStorage.getItem('notFancy') == "true"){
  $('html').addClass('notFancy')
}

//prevent dragging a file to the window from loading that file
window.addEventListener("dragover",function(e){
  e = e || event;
  e.preventDefault();
},false);
window.addEventListener("drop",function(e){
  e = e || event;
  e.preventDefault();
},false);

//prevent enter from submitting forms
window.addEventListener('keypress', function(event) {
  if (event.keyCode == 13) {
    event.preventDefault();
  }
});

var setCurrentBitCoin = function(cCode, userModel, callback) {
  "use strict";
  getBTPrice(cCode, function (btAve, currencyList) {
    //put the current bitcoin price in the window so it doesn't have to be passed to models
    if (!btAve){
      currencyList = currencyList.join("\n");
      alert("Bitcoin prices for your selected currency are not available. Your currency has been set to BTC. " +
          "You can change this in the settings console. \n\n The following currencies are available: \n\n" + currencyList);
      window.currentBitcoin = 1;
      userModel.set('currency_code', 'BTC');
    }
    window.currentBitcoin = btAve;
    typeof callback === 'function' && callback();
  });
};

var profileLoaded;
var loadProfile = function(landingRoute, onboarded) {
  var externalRoute = remote.getGlobal('externalRoute');

  profileLoaded = true;

  //get the guid from the user profile to put in the user model
  userProfile.fetch({
    timeout: 4000,
    success: function (model, response) {
      "use strict";
      //make sure profile is not blank
      if (response.profile){
        setTheme(model.get('profile').primary_color, model.get('profile').secondary_color, model.get('profile').background_color, model.get('profile').text_color);
        //get the user
        user.fetch({
          success: function (model, response) {
            cCode = model.get('currency_code');

            //get user bitcoin price before loading pages
            setCurrentBitCoin(cCode, user, function() {
              newSocketView = new socketView({model: serverConfigMd});

              newPageNavView = new pageNavView({
                model: user,
                socketView: newSocketView,
                userProfile: userProfile,
                showDiscIntro: onboarded
              }).render();
              
              app.chatVw = new ChatVw({
                model: user,
                socketView: newSocketView
              });

              $('#sideBar').html(app.chatVw.render().el);

              app.router = new router({userModel: user, userProfile: userProfile, socketView: newSocketView});

              if (externalRoute) {
                app.router.translateRoute(externalRoute).done((translatedRoute) => {
                  location.hash = translatedRoute;
                  Backbone.history.start();
                });
              } else {
                location.hash = landingRoute || '#';
                Backbone.history.start();
              }
            });

            //every 15 minutes update the bitcoin price for the currently selected currency
            window.bitCoinPriceChecker = setInterval(function () {
              setCurrentBitCoin(model.get('currency_code'), user);
            }, 54000000);
          }
        });
      }
    }
  });
};

$(document).ajaxError(function(event, jqxhr, settings, thrownError) {
  if (jqxhr.status === 401) {
    if (after401LoginRequest && after401LoginRequest.state() === 'pending') return;

    after401LoginRequest = app.login().done(function(data) {
      var route = location.hash;

      if (data.success) {
        // refresh the current route
        Backbone.history.navigate('blah-blah-blah');
        Backbone.history.navigate(route, { trigger: true });
      } else {
        launchServerConnect();
      }
    }).fail(function() {
      launchServerConnect();
    });
  }
});

launchOnboarding = function(guidCreating) {
  serverConnectModal && serverConnectModal.remove();
  serverConnectModal = null;  

  onboardingModal && onboardingModal.remove();
  onboardingModal = new OnboardingModal({
    model: user,
    userProfile: userProfile,
    serverConfig: serverConfigMd,
    guidCreationPromise: guidCreating
  });
  onboardingModal.render().open();

  onboardingModal.on('onboarding-complete', function(guid) {
    onboardingModal && onboardingModal.remove()
    onboardingModal = null;
    loadProfile('#userPage/' + guid + '/store', true);
    $loadingModal.removeClass('hide');
  });
};

launchServerConnect = function() {
  if (!serverConnectModal) {
    serverConnectModal = new ServerConnectModal();

    serverConnectModal.on('connected', function(authenticated) {
      $loadingModal.removeClass('hide');

      if (authenticated) {
        serverConnectModal && serverConnectModal.remove();
        serverConnectModal = null;        
      }
    });

    serverConnectModal.render()
      .open()
      .start();
  } else {
    if (!serverConnectModal.isOpen()) {
      serverConnectModal.open();
      if (!serverConnectModal.isStarted()) serverConnectModal.start();
    }
  }
};

heartbeat.on('open', function(e) {
  if (profileLoaded) {
    location.reload();
  } else {
    // clear some flags so the heartbeat events will
    // appropriatally loadProfile or launch onboarding
    guidCreating = null;
    loadProfileNeeded = true;

    onboardingModal && onboardingModal.remove();
  }
});

heartbeat.on('close', function(e) {
  if (
    Date.now() - startTime < startUpConnectMaxTime &&
    startUpConnectMaxRetries
  ) {
    setTimeout(() => {
      startUpConnectMaxRetries--;
      app.connectHeartbeatSocket();
    }, startUpConnectRetryDelay);
  } else {
    launchServerConnect();
  }
});

heartbeat.on('message', function(e) {
  if (e.jsonData && e.jsonData.status) {
    switch (e.jsonData.status) {
      case 'generating GUID':
        if (guidCreating) return;

        // todo: put in some timeout in the off chance the guid
        // creation process doesn't complete after a long time.
        guidCreating = $.Deferred();

        // launch onboarding, pass in guid creating
        launchOnboarding(guidCreating);
        break;
      case 'GUID generation complete':
        var creds = {
          username: e.jsonData.username,
          password: e.jsonData.password
        };

        if (app.serverConfig.isLocalServer()) {
          creds.local_username = e.jsonData.username;
          creds.local_password = e.jsonData.password;
        }

        serverConfigMd.save(creds);

        app.login().done(function() {
          guidCreating.resolve();
        });

        break;
      case 'online':
        if (loadProfileNeeded && !guidCreating) {
          loadProfileNeeded = false;

          app.login().done(function(data) {
            if (data.success) {
              $.getJSON(serverConfigMd.getServerBaseUrl() + '/profile').done(function(profile) {
                if (__.isEmpty(profile)) {
                  launchOnboarding(guidCreating = $.Deferred().resolve().promise());
                } else {
                  loadProfile();              
                }
              });
            } else {
              launchServerConnect();
            }
          }).fail(function() {
            launchServerConnect();
          });
        }

        // todo: check for edge case where guid creating
        // is still pending here, meaning the GUID generation
        // complete message never arrived. Auth will fail.
    }
  }
});