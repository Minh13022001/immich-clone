// function addItem(name) {
//   const alreadyExists = name === "cat.jpg";

//   if (alreadyExists) {
//     return false;
//   }

//   return true;
// }

// const jobs = ["dog.jpg", "cat.jpg", "bird.jpg"].map((file) => {
//   console.log("Checking:", file);

//   if (!addItem(file)) {
//     console.log("Already exists:", file);
//     console.log(Promise.resolve('66'), 999);
//     return Promise.resolve(undefined);
//   }

//   console.log("Starting work:", file);

//   return new Promise((resolve) => {
//     setTimeout(() => {
//       console.log("Finished:", file);
//       resolve(file);
//     }, 1000);
//   });
// });

// console.log("jobs:", jobs);

// Promise.all(jobs).then((results) => {
//   console.log("ALL FINISHED:", results);
// });

//Promise is a type of object (like Date)
// Promise { <pending> } mean i am a Promise and the thing inside <> is the state
// Promise { 66 } mean i am a Promise and my value is 66



// function push(task) {
//   return new Promise((resolve, reject) => {
//     console.log('1');

//     const callback = () => task().then(resolve, reject);

//     console.log('2');
//     callback();

//     console.log('3');
//   });
// }

// const promise = push(() => {
//   console.log('4');

//   return Promise.resolve('Done');
// });

// // const result = push(() => console.log(123))
// console.log('5');
// console.log(promise, 99);

// promise.then((result) => console.log(result));

export {}; 

// function promisy() {
//   const thing = new Promise((resolve) => {
//   console.log(1);
//   resolve('Hello');
//   console.log(2);

//   });
//   return thing
// }

// const thingy = promisy()

// console.log(thingy, 99);


// const newR = thingy.then((shit) => {
//   console.log(shit, 12);
//   return shit
// });

// const ad = await newR;


// console.log(newR, ad, 1000);





// Promise.resolve(2)
//   .then((n) => {
//     console.log(n); // 2
//     // return n * 3;
//   })
//   .then((n) => {
//     console.log(n); // undefined
//   })
//   .then((n) => {
//     console.log(n); // undefined
//   });


function getData() {
  return new Promise(resolve => {
    setTimeout(() => resolve('Data received'), 2000);
  });
}

async function upload() {
  console.log('1. Upload started');

  const result = await getData();

  console.log('3.', result);
}

function queue() {
  upload();

  console.log('2. Queue continues');
}

queue();

// so this is just callback queue