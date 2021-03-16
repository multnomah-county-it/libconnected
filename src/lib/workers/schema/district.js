const yup = require('yup');
const moment = require('moment');

function emptyStringToNull(value, originalValue) {
  if (typeof originalValue === 'string' && originalValue === '') {
    return null;
  }
  return value;
}

module.exports = yup.object().shape({
  student_id: yup.number().required().integer().min(100000).max(999999),
  first_name: yup.string().required(),
  middle_name: yup.string(),
  last_name: yup.string().required(),
  home_address: yup.string(),
  city: yup.string().transform(emptyStringToNull).nullable(),
  state: yup.string().transform(emptyStringToNull).nullable(),
  zipcode: yup.number().min(0).max(99999).transform(emptyStringToNull).nullable(),
  dob: yup.date().min(moment().subtract(22, 'years').toDate()).max(moment().add(1, 'days').toDate()).required(),
  email: yup.string().email()
});
