import {animate, createTimeline, createTimer, utils, stagger, waapi } from 'animejs';

// const [ $time, $count ] = utils.$('.value');
// const [timer1, timer2, timer3] = utils.$('.deadline-timer');
// const [ dotAll ] = utils.$('.element');

const deadline = new Date("Feb 23, 2026 23:00:00").getTime();
// 2. DOM elements
// const [ daysEl ] = utils.$('.days');
// const [ hoursEl ] = utils.$('.hours');
// const [ minutesEl ] = utils.$('.minutes');
// const [ secondsEl ] = utils.$('.seconds');

// At the top of your file, define the colors
const COLORS = ['#FF875B', '#FFE8E8', '#F668FF', '#FF20C7'];


// Generate web component for the countdown
// <div class="small justified row">
//  <div class="square" ></div>
//

const grid = [5, 5]; //2x2 kyk e bagus jg
// const $squares = utils.$('.square');


const zero = [
    0,1,1,1,0,
    1,0,0,0,1,
    1,0,0,0,1,
    1,0,0,0,1,
    0,1,1,1,0
];

function initNumber($squares){
    animate($squares,{
        // targets: '.square',
        backgroundColor: (el, i) => zero[i] ? '#FF875B' : '#FFE8E8',
        delay: stagger(0, {grid: [5, 5], from: 'center'}),
        // duration: 3000,
        easing: 'easeInOutQuad',
        // onComplete: initNumber
    });
}

function animateGrid($squares) {
    const from = utils.random(0, 5 * 5);
    animate($squares, {
        translateX: [
            {to: stagger('-.75rem', {grid, from, axis: 'x'})},
            {to: 0, ease: 'inOutQuad',},
        ],
        translateY: [
            {to: stagger('-.75rem', {grid, from, axis: 'y'})},
            {to: 0, ease: 'inOutQuad'},
        ],
        opacity: [
            {to: .5},
            {to: 1}
        ],
        delay: stagger(85, {grid, from}),
        backgroundColor: ['#B8FFE9', '#FF875B', '#FFE8E8'],
        // onComplete: animateGrid
    });
}

// async function createCountdownGrid(){
//     let countdown = document.querySelector('.countdown');
//     const countdownGridRows = 5;
//     const countdownGridCols = 5;
//     for (let i = 0; i < countdownGridRows; i++)
//     {
//         let rows = document.createElement('div');
//         rows.classList.add('small', 'justified', 'row');
//         for( let j = 0; j < countdownGridCols; j++)
//         {
//             let cols = document.createElement('div');
//             cols.classList.add('square');
//             rows.appendChild(cols);
//         }
//         countdown.appendChild(rows);
//     }
// }
// createCountdownGrid().then( );

// createCountdownGrid()
//     .then(()=>{
//         const $squares = utils.$('.square');
//         const numberTimeline = createTimeline({
//             loopDelay: 1000,
//             loop: true,
//         })
//             .add({
//                 duration: 3000,
//                 onUpdate: initNumber,
//             })
//             .add({
//                 duration: 3000,
//                 onUpdate: animateGrid,
//             });
//     });


// const timer = createTimer({
//     duration: 5000,
//     // loop: true,
//     frameRate: 30,
//     onUpdate: (self) => {
//         const remaining = Math.ceil((self.duration - self.currentTime) / 1000);
//         timer1.innerHTML = `${remaining}s`;
//     },
//     complete: () => {
//       timer1.innerHTML = 'Deadline Passed!';
//     }
//     });
//
// // 3. Create the Anime.js Timer
// const timer_countdown = createTimer({
//     duration: Infinity, // Keep running until cleared
//     onUpdate: self => {
//         const now = new Date().getTime();
//         const t = deadline - now;
//
//         if (t > 0) {
//             // Calculate remaining time
//             const days = Math.floor(t / (1000 * 60 * 60 * 24));
//             const hours = Math.floor((t / (1000 * 60 * 60)) % 24);
//             const minutes = Math.floor((t / 1000 / 60) % 60);
//             const seconds = Math.floor((t / 1000) % 60);
//
//             // Update DOM with zero-padding
//             daysEl.innerHTML = days;
//             hoursEl.innerHTML = ('0' + hours).slice(-2);
//             minutesEl.innerHTML = ('0' + minutes).slice(-2);
//             secondsEl.innerHTML = ('0' + seconds).slice(-2);
//         } else {
//             // Deadline reached
//             timer_countdown.pause();
//             document.querySelector('.timer').innerHTML = "Deadline Passed";
//         }
//     }
// });
//
//
// const timeline = createTimeline()
//     .sync(timer)
//     .add({
//         duration: 1500,
//         onUpdate: (self) => {timer2.innerHTML = `${self.currentTime}s`;},
//     })
//     .add({
//         duration: 1000,
//         onUpdate: (self) => {timer3.innerHTML = `${self.currentTime}s`;},
//     })


// DOT GRID ANIMATION
//
const numDot = 900;
let container = document.querySelector('.grid-container');

for (let i = 0; i < numDot; i++)
{
    let dot = document.createElement('div');
    dot.classList.add('element');
    container.appendChild(dot);
}

let panelGrid1 = [30,30];
let dotAll = document.querySelectorAll('.element');

function animateWelcomeGridTopLeft()
{
    animate(dotAll, {
        rotate: function() { return utils.random(-360,360)},
        translateY: function()  { return utils.random(-150, 150)},
        translateX: function() { return utils.random(-150, 150)},
        delay: stagger(100, { grid: panelGrid1, from: "" } ),
        backgroundColor: ['#FF875B', '#FFE8E8', '#F668FF', '#FF20C7'],
        playbackRate: 2.85,
    })
}

function animateWelcomeGridCenter()
{
    animate(dotAll, {
        rotate: function() { return utils.random(-360,360)},
        translateY: function()  { return utils.random(-150, 150)},
        translateX: function() { return utils.random(-150, 150)},
        delay: stagger(100, { grid: panelGrid1, from: "center" } ),
        backgroundColor: ['#FF875B', '#FFE8E8', '#F668FF', '#FF20C7'],
        playbackRate: 2.34,
    })
}

function animateWelcomeGridTopReverse()
{
    animate(dotAll, {
        rotate: function() { return utils.random(0,0)},
        translateY: function()  { return utils.random(0,0)},
        translateX: function() { return utils.random(0,0)},
        delay: stagger(20, { grid: panelGrid1, from: "last" } ),
        backgroundColor: ['#FFE8E8', '#FF875B'],
        playbackRate: 2.4,
    })
}

let animation = createTimeline({
    // targets: dotAll,
    // loopDelay: 2000,
    // loop: true,
    easing: 'easeInOutExpo',
});
animation.add({
    duration: 100,
    onBegin: animateWelcomeGridTopLeft} )
animation.add({
    duration: 1400, // generally it takes 3200 to complete the animation
})
animation.add( {
    duration: 150,
    onComplete: animateWelcomeGridCenter,
})
animation.add({
    duration: 1300, // generally it takes 3200 to complete the animation
})
animation.add( {
    duration: 100,
    onUpdate: animateWelcomeGridTopReverse} );
animation.add({
    duration: 150, // generally it takes 600 to complete the animation
});


// SPLASH SCREEN
// Wait until the entire window (including all assets like images) has loaded
window.addEventListener('load', function() {
    const splashScreen = document.getElementById('splash-screen');
    const mainContent = document.getElementById('main-content');

    // Add a class to start the CSS transition (fade out)
    // splashScreen.delay = 2500;
    setTimeout( ()=> {
        splashScreen.classList.add('hidden');

    }, 3000 );


    // Optional: Hide the splash screen completely and show main content after the transition finishes
    splashScreen.addEventListener('transitionend', function() {
        splashScreen.style.display = 'none';
        mainContent.style.display = 'block'; // Show main content
    });
});


// Helper: waits for a waapi animation on multiple elements to finish
// waapi.animate(NodeList) returns an array of Web Animation objects
// function waapiStagger(targets, props, fromMode) {
//     const els = Array.from(targets);
//     const total = els.length;
//
//     // Manually compute stagger delay based on grid position
//     els.forEach((el, i) => {
//         const col = i % 30;
//         const row = Math.floor(i / 30);
//
//         let fromCol, fromRow;
//         if (fromMode === 'center') {
//             fromCol = 14.5; fromRow = 14.5;
//         } else if (fromMode === 'last') {
//             fromCol = 29; fromRow = 29;
//         } else {
//             fromCol = 0; fromRow = 0;  // 'first'
//         }
//
//         const dist = Math.sqrt((col - fromCol) ** 2 + (row - fromRow) ** 2);
//         const maxDist = Math.sqrt(29 ** 2 + 29 ** 2);
//         const delay = (dist / maxDist) * 800;  // spread over 800ms
//
//         // el.style.backgroundColor = COLORS[Math.floor(Math.random() * COLORS.length)];
//
//         el.animate(
//             [
//                 { transform: `translateX(${el._tx || 0}px) translateY(${el._ty || 0}px) rotate(${el._r || 0}deg)` },
//                 { transform: `translateX(${props.translateX()}px) translateY(${props.translateY()}px) rotate(${props.rotate()}deg)` }
//             ],
//             { duration: props.duration, delay, easing: 'ease-in-out', fill: 'forwards' }
//         );
//
//         el.animate(
//             [
//                 { backgroundColor: el.style.backgroundColor || '#FF875B' },
//                 { backgroundColor: COLORS[Math.floor(Math.random() * COLORS.length)] }
//             ],
//             { duration: 600, delay, fill: 'forwards' }
//         );
//
//         // Store last values so next animation starts from current position
//         el._tx = props.translateX ? props.translateX() : 0;
//         el._ty = props.translateY ? props.translateY() : 0;
//         el._r  = props.rotate    ? props.rotate()     : 0;
//     });
//
//     // Wait for the LAST element to finish (it has the longest delay)
//     const lastEl = els[els.length - 1];
//     const anims  = lastEl.getAnimations();
//     return anims[anims.length - 1].finished;
// }
//
// async function runLoop() {
//     while (true) {
//         await waapiStagger(dotAll, {
//             translateX: () => utils.random(-150, 150),
//             translateY: () => utils.random(-150, 150),
//             rotate:     () => utils.random(-360, 360),
//             duration: 600,
//         }, 'first');
//
//         await new Promise(r => setTimeout(r, 300));
//
//         await waapiStagger(dotAll, {
//             translateX: () => utils.random(-150, 150),
//             translateY: () => utils.random(-150, 150),
//             rotate:     () => utils.random(-360, 360),
//             duration: 600,
//         }, 'center');
//
//         await new Promise(r => setTimeout(r, 300));
//
//         await waapiStagger(dotAll, {
//             translateX: () => 0,
//             translateY: () => 0,
//             rotate:     () => 0,
//             duration: 600,
//         }, 'last');
//
//         await new Promise(r => setTimeout(r, 300));
//     }
// }
//
// runLoop();

