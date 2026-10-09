function addItem(name) {
  const alreadyExists = name === "cat.jpg";

  if (alreadyExists) {
    return false;
  }

  return true;
}

const jobs = ["dog.jpg", "cat.jpg", "bird.jpg"].map((file) => {
  console.log("Checking:", file);

  if (!addItem(file)) {
    console.log("Already exists:", file);
    console.log(Promise.resolve('pending'), 999);
    return Promise.resolve(undefined);
  }

  console.log("Starting work:", file);

  return new Promise((resolve) => {
    setTimeout(() => {
      console.log("Finished:", file);
      resolve(file);
    }, 1000);
  });
});

console.log("jobs:", jobs);

Promise.all(jobs).then((results) => {
  console.log("ALL FINISHED:", results);
});

//Promise is a type of object (like Date)
// Promise { <pending> } mean i am a Promise and the thing inside <> is the state
// Promise { 66 } mean i am a Promise and my value is 66
